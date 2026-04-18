"use client";

import { useEffect, useRef, useState } from "react";
import { frameAt, loadChoreo, type Choreo } from "./choreography";
import { useSession } from "./SessionProvider";

// Draws the reference choreography stick figure *on top of the local
// dancer* — anchored on their shoulders, scaled to their torso, so the
// ghost is a pose they can literally step into. Lives inside the tile's
// tracking wrapper so it mirrors and pans with the webcam.
const CONN: [number, number][] = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 32],
  [0, 11],
  [0, 12],
];

export function ChoreoOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { match, phase, localFrameRef } = useSession();
  const [choreo, setChoreo] = useState<Choreo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadChoreo().then((c) => {
      if (!cancelled) setChoreo(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    let raf = 0;
    let cancelled = false;

    function loop() {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      if (!canvas || !ctx) return;

      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      ctx.clearRect(0, 0, W, H);

      if (!choreo || !match) return;
      if (phase !== "playing" && phase !== "countdown") return;
      const elapsed = Date.now() - match.startAt;
      if (elapsed < 0) return;

      const ref = frameAt(choreo, elapsed);
      if (!ref) return;

      const user = localFrameRef.current;
      if (!user) return;
      const uLS = user.landmarks[11];
      const uRS = user.landmarks[12];
      const uLH = user.landmarks[23];
      const uRH = user.landmarks[24];
      if (!uLS || !uRS || !uLH || !uRH) return;
      if (
        (uLS.visibility ?? 1) < 0.35 ||
        (uRS.visibility ?? 1) < 0.35 ||
        (uLH.visibility ?? 1) < 0.35 ||
        (uRH.visibility ?? 1) < 0.35
      ) {
        return;
      }

      // User torso in tile-pixel coords
      const usM = {
        x: ((uLS.x + uRS.x) / 2) * W,
        y: ((uLS.y + uRS.y) / 2) * H,
      };
      const uhM = {
        x: ((uLH.x + uRH.x) / 2) * W,
        y: ((uLH.y + uRH.y) / 2) * H,
      };
      const userTorsoPx = Math.hypot(usM.x - uhM.x, usM.y - uhM.y);
      if (userTorsoPx < 20) return;

      // Reference torso in reference-pixel coords
      const refW = choreo.videoWidth || 1280;
      const refH = choreo.videoHeight || 720;
      const rLS = ref.lm[11];
      const rRS = ref.lm[12];
      const rLH = ref.lm[23];
      const rRH = ref.lm[24];
      if (!rLS || !rRS || !rLH || !rRH) return;
      const rsM = {
        x: ((rLS.x + rRS.x) / 2) * refW,
        y: ((rLS.y + rRS.y) / 2) * refH,
      };
      const rhM = {
        x: ((rLH.x + rRH.x) / 2) * refW,
        y: ((rLH.y + rRH.y) / 2) * refH,
      };
      const refTorsoPx = Math.hypot(rsM.x - rhM.x, rsM.y - rhM.y);
      if (refTorsoPx < 10) return;

      const scale = userTorsoPx / refTorsoPx;

      // Project any reference landmark into tile-pixel coords, anchored
      // on the user's shoulder midpoint and scaled by torso ratio.
      function project(
        p: { x: number; y: number },
      ): [number, number] {
        const dxRef = p.x * refW - rsM.x;
        const dyRef = p.y * refH - rsM.y;
        return [usM.x + dxRef * scale, usM.y + dyRef * scale];
      }

      // Similarity from the scorer drives color + opacity
      const sim = user.similarity;
      const mix = Math.max(0, Math.min(1, sim));
      const r = Math.round(255 * (1 - mix) + 74 * mix);
      const g = Math.round(180 * (1 - mix) + 222 * mix);
      const b = Math.round(240 * (1 - mix) + 128 * mix);
      const alpha = 0.6;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 0.9})`;
      ctx.shadowBlur = 16;
      ctx.lineWidth = Math.max(4, userTorsoPx * 0.05);

      for (const [a, b2] of CONN) {
        const pa = ref.lm[a];
        const pb = ref.lm[b2];
        if (!pa || !pb) continue;
        if (pa.v < 0.3 || pb.v < 0.3) continue;
        const [ax, ay] = project(pa);
        const [bx, by] = project(pb);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }

      // Head circle from nose landmark
      const nose = ref.lm[0];
      if (nose && nose.v > 0.3) {
        const [nx, ny] = project(nose);
        ctx.beginPath();
        ctx.arc(nx, ny, userTorsoPx * 0.18, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Joint dots
      ctx.shadowBlur = 8;
      for (let i = 11; i <= 32; i++) {
        const p = ref.lm[i];
        if (!p || p.v < 0.3) continue;
        const [x, y] = project(p);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3, userTorsoPx * 0.025), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [choreo, phase, match, localFrameRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[4] h-full w-full"
    />
  );
}
