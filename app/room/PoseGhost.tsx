"use client";

import { useEffect, useRef, useState } from "react";
import { BONES } from "./poseLibrary";
import { useSession } from "./SessionProvider";

// ------- Figure ----------
// Per-bone target guides that sit on top of the real MediaPipe skeleton
// (BodyAura). For each bone in the active pose we draw a faded ghost line
// from the player's actual parent joint in the target direction, same
// length as their real bone. When the player rotates their limb to match,
// their colored skeleton line covers the ghost. No separate stick figure.
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
      fadeIn = Math.min(1, fadeIn + 0.07);

      const lm = f.landmarks;
      const pulse = 0.85 + 0.15 * Math.sin(now / 220);

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (let i = 0; i < BONES.length; i++) {
        const bone = BONES[i];
        const targetVec = target.vectors[i];
        if (!targetVec) continue;

        const parent = lm[bone.from];
        const child = lm[bone.to];
        if (!parent || !child) continue;
        if ((parent.visibility ?? 1) < 0.3) continue;

        const px = parent.x * w;
        const py = parent.y * h;

        // Use the player's current bone length (fall back to a torso-based
        // estimate if the child is hidden).
        let realLen: number;
        let alignment = 0;
        if ((child.visibility ?? 1) >= 0.3) {
          const dx = child.x - parent.x;
          const dy = child.y - parent.y;
          const mag = Math.hypot(dx, dy);
          realLen = Math.hypot(dx * w, dy * h);
          if (mag > 0.001) {
            const ux = dx / mag;
            const uy = dy / mag;
            alignment = Math.max(
              0,
              ux * targetVec[0] + uy * targetVec[1],
            );
          }
        } else {
          realLen = 0.18 * h; // default limb length when hidden
        }
        if (realLen < 30) realLen = 30;

        const gx = px + targetVec[0] * realLen;
        const gy = py + targetVec[1] * realLen;

        // The ghost fades out as the player aligns with it — aligned bones
        // get a brief green flash instead of clutter.
        const misalign = 1 - alignment;
        const aligned = alignment > 0.82;

        const baseAlpha = (aligned ? 0.35 : 0.25 + misalign * 0.6) * fadeIn;
        const pulseAlpha = aligned ? baseAlpha : baseAlpha * pulse;

        // Color: misaligned = white/amber attention; aligned = neon green
        const r = aligned ? 74 : 255;
        const g = aligned ? 222 : 236;
        const b = aligned ? 128 : 180;

        ctx.shadowBlur = aligned ? 14 : 10;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${pulseAlpha * 0.8})`;
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${pulseAlpha})`;
        ctx.setLineDash(aligned ? [] : [10, 8]);
        ctx.lineWidth = aligned ? 6 : 5;

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(gx, gy);
        ctx.stroke();

        // Target endpoint dot to mark "put your wrist/ankle here"
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pulseAlpha})`;
        ctx.beginPath();
        ctx.arc(gx, gy, aligned ? 7 : 9, 0, Math.PI * 2);
        ctx.fill();
      }

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
