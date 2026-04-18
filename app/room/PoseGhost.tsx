"use client";

import { useEffect, useRef, useState } from "react";
import { BONES } from "./poseLibrary";
import { useSession } from "./SessionProvider";

// Stick-figure silhouette of the active target pose, drawn in the center
// of the tile. Canvas is CSS-mirrored so it lines up with the user's
// mirrored self-view. The label sits above in plain DOM so it reads
// correctly.
export function PoseGhost() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { localFrameRef } = useSession();
  const [label, setLabel] = useState<string>("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let cancelled = false;
    let lastTargetIdx = -1;
    let fadeIn = 0; // 0..1 over a few frames after pose switch
    let lastLabel = "";
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
      if (now - lastTs < 33) return; // cap at ~30fps
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

      if (target.label !== lastLabel) {
        lastLabel = target.label;
        setLabel(target.label);
      }

      // Fixed body anchors in tile coords
      const shoulderL = { x: w * 0.5 + w * 0.055, y: h * 0.3 };
      const shoulderR = { x: w * 0.5 - w * 0.055, y: h * 0.3 };
      const hipL = { x: w * 0.5 + w * 0.045, y: h * 0.55 };
      const hipR = { x: w * 0.5 - w * 0.045, y: h * 0.55 };

      const upperArmLen = h * 0.14;
      const forearmLen = h * 0.14;
      const thighLen = h * 0.17;
      const shinLen = h * 0.17;

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
        return h * 0.1;
      };

      // Score-tinted color: white -> neon green as similarity climbs
      const sim = f.similarity;
      const mix = Math.max(0, Math.min(1, sim));
      // blend white (255,255,255) -> #4ade80 (74, 222, 128)
      const r = Math.round(255 * (1 - mix) + 74 * mix);
      const g = Math.round(255 * (1 - mix) + 222 * mix);
      const b = Math.round(255 * (1 - mix) + 128 * mix);
      const alpha = (0.55 + mix * 0.35) * fadeIn;
      const strokeColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      const glowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 0.9})`;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = strokeColor;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 18 * fadeIn;
      ctx.lineWidth = 10;

      // Torso frame first (so limbs sit on top visually)
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

      // Limbs
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
      const headCx = (shoulderL.x + shoulderR.x) / 2;
      const headCy = (shoulderL.y + shoulderR.y) / 2 - h * 0.07;
      const headR = h * 0.06;
      ctx.beginPath();
      ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
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
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-[4] h-full w-full [transform:scaleX(-1)]"
      />
      <div
        className="pointer-events-none absolute left-1/2 top-[12%] z-[5] -translate-x-1/2 rounded-full border border-white/20 bg-black/60 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.3em] text-white backdrop-blur"
      >
        {label || "—"}
      </div>
    </>
  );
}
