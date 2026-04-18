"use client";

import { useEffect, useRef, useState } from "react";
import { BONES } from "./poseLibrary";
import { useSession } from "./SessionProvider";

// ------- Figure ----------
// Canvas stick-figure drawn at the player's actual shoulders/hips. Meant
// to live *inside* the tile's tracking wrapper so it pans/zooms with the
// video and the CSS mirror. No self-mirror on this canvas.
export function PoseGhostFigure() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { localFrameRef } = useSession();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let cancelled = false;
    let lastTargetIdx = -1;
    let fadeIn = 0;
    let lastTs = 0;

    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      if (!canvas || !ctx) return;

      const now = performance.now();
      if (now - lastTs < 33) return;
      lastTs = now;

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const f = localFrameRef.current;
      const target = f?.target;
      if (!target) return;

      if (f.targetIdx !== lastTargetIdx) {
        lastTargetIdx = f.targetIdx;
        fadeIn = 0;
      }
      fadeIn = Math.min(1, fadeIn + 0.06);

      // Anchor on the player's actual torso landmarks
      const lm = f.landmarks;
      const ls = lm[11];
      const rs = lm[12];
      const lh = lm[23];
      const rh = lm[24];
      if (!ls || !rs || !lh || !rh) return;
      if (
        (ls.visibility ?? 1) < 0.3 ||
        (rs.visibility ?? 1) < 0.3 ||
        (lh.visibility ?? 1) < 0.3 ||
        (rh.visibility ?? 1) < 0.3
      ) {
        return;
      }

      const shoulderL = { x: ls.x * w, y: ls.y * h };
      const shoulderR = { x: rs.x * w, y: rs.y * h };
      const hipL = { x: lh.x * w, y: lh.y * h };
      const hipR = { x: rh.x * w, y: rh.y * h };

      const shoulderMid = {
        x: (shoulderL.x + shoulderR.x) / 2,
        y: (shoulderL.y + shoulderR.y) / 2,
      };
      const hipMid = {
        x: (hipL.x + hipR.x) / 2,
        y: (hipL.y + hipR.y) / 2,
      };
      const torsoHeight = Math.max(
        40,
        Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y),
      );

      const upperArmLen = torsoHeight * 0.55;
      const forearmLen = torsoHeight * 0.55;
      const thighLen = torsoHeight * 0.75;
      const shinLen = torsoHeight * 0.75;

      const joints = new Map<number, { x: number; y: number }>();
      joints.set(11, shoulderL);
      joints.set(12, shoulderR);
      joints.set(23, hipL);
      joints.set(24, hipR);

      const getLen = (from: number, to: number) => {
        if (from === 11 && to === 13) return upperArmLen;
        if (from === 13 && to === 15) return forearmLen;
        if (from === 12 && to === 14) return upperArmLen;
        if (from === 14 && to === 16) return forearmLen;
        if (from === 23 && to === 25) return thighLen;
        if (from === 25 && to === 27) return shinLen;
        if (from === 24 && to === 26) return thighLen;
        if (from === 26 && to === 28) return shinLen;
        return torsoHeight * 0.5;
      };

      // Color blends white → neon green as similarity climbs
      const sim = f.similarity;
      const mix = Math.max(0, Math.min(1, sim));
      const rC = Math.round(255 * (1 - mix) + 74 * mix);
      const gC = Math.round(255 * (1 - mix) + 222 * mix);
      const bC = Math.round(255 * (1 - mix) + 128 * mix);
      const alpha = (0.5 + mix * 0.4) * fadeIn;
      const strokeColor = `rgba(${rC}, ${gC}, ${bC}, ${alpha})`;
      const glowColor = `rgba(${rC}, ${gC}, ${bC}, ${alpha * 0.9})`;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = strokeColor;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 14 * fadeIn;
      ctx.lineWidth = Math.max(6, torsoHeight * 0.08);

      // Torso frame
      ctx.beginPath();
      ctx.moveTo(shoulderL.x, shoulderL.y);
      ctx.lineTo(shoulderR.x, shoulderR.y);
      ctx.moveTo(hipL.x, hipL.y);
      ctx.lineTo(hipR.x, hipR.y);
      ctx.moveTo(shoulderL.x, shoulderL.y);
      ctx.lineTo(hipL.x, hipL.y);
      ctx.moveTo(shoulderR.x, shoulderR.y);
      ctx.lineTo(hipR.x, hipR.y);
      ctx.stroke();

      // Limbs driven by target pose vectors
      for (let i = 0; i < BONES.length; i++) {
        const bone = BONES[i];
        const vec = target.vectors[i];
        const start = joints.get(bone.from);
        if (!start || !vec) continue;
        const len = getLen(bone.from, bone.to);
        const end = {
          x: start.x + vec[0] * len,
          y: start.y + vec[1] * len,
        };
        joints.set(bone.to, end);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }

      // Head circle
      const headR = torsoHeight * 0.22;
      ctx.beginPath();
      ctx.arc(shoulderMid.x, shoulderMid.y - torsoHeight * 0.4, headR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
    loop();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [localFrameRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[4] h-full w-full"
    />
  );
}

// ------- Label ----------
// Lives at the top of the tile, OUTSIDE the tracking wrapper so it doesn't
// mirror-flip or pan-translate away.
export function PoseGhostLabel() {
  const { localFrameRef } = useSession();
  const [label, setLabel] = useState("");

  useEffect(() => {
    let rafId = 0;
    let cancelled = false;
    let lastLabel = "";
    let lastTs = 0;

    function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      const now = performance.now();
      if (now - lastTs < 200) return; // label only needs to check ~5 Hz
      lastTs = now;
      const f = localFrameRef.current;
      const cur = f?.target?.label ?? "";
      if (cur !== lastLabel) {
        lastLabel = cur;
        setLabel(cur);
      }
    }
    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [localFrameRef]);

  if (!label) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[10%] z-[20] -translate-x-1/2 rounded-full border border-white/20 bg-black/70 px-5 py-1.5 font-mono text-xs uppercase tracking-[0.3em] text-white backdrop-blur">
      {label}
    </div>
  );
}
