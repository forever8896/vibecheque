"use client";

import { useEffect, useRef, useState } from "react";
import { frameAt, loadChoreo, type Choreo } from "./choreography";
import { useSession } from "./SessionProvider";

// Small reference-dancer preview in a corner of the local tile. Replays
// the extracted choreography time-aligned to the match clock. This is
// *just visual* — the scoring already targets these frames in
// usePoseScore.
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

export function ChoreoPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { match, phase } = useSession();
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
    if (!choreo) return;
    if (phase !== "playing" && phase !== "countdown") return;
    if (!match) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = 160;
    const cssH = 220;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    let cancelled = false;

    function draw() {
      if (cancelled) return;
      raf = requestAnimationFrame(draw);
      if (!canvas || !ctx || !choreo) return;
      if (!match) return;
      const now = Date.now();
      const elapsed = now - match.startAt;
      if (elapsed < 0) {
        ctx.clearRect(0, 0, cssW, cssH);
        return;
      }
      const frame = frameAt(choreo, elapsed);
      if (!frame) return;

      // Bounding box of body to fit the preview
      const body: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= 32; i++) {
        const p = frame.lm[i];
        if (p && p.v > 0.3) body.push(p);
      }
      if (body.length < 4) return;
      let minX = 1,
        minY = 1,
        maxX = 0,
        maxY = 0;
      for (const p of body) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = 0.08;
      minX = Math.max(0, minX - pad);
      maxX = Math.min(1, maxX + pad);
      minY = Math.max(0, minY - pad);
      maxY = Math.min(1, maxY + pad);
      const bw = maxX - minX;
      const bh = maxY - minY;
      const scale = Math.min(cssW / (bw * cssW), cssH / (bh * cssH));
      const offX = -minX * cssW * scale + (cssW - bw * cssW * scale) / 2;
      const offY = -minY * cssH * scale + (cssH - bh * cssH * scale) / 2;

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, cssW, cssH);

      ctx.strokeStyle = "rgba(255,77,240,0.95)";
      ctx.fillStyle = "rgba(255,77,240,0.95)";
      ctx.shadowColor = "rgba(255,77,240,0.6)";
      ctx.shadowBlur = 10;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";

      const toX = (x: number) => x * cssW * scale + offX;
      const toY = (y: number) => y * cssH * scale + offY;

      for (const [a, b] of CONN) {
        const pa = frame.lm[a];
        const pb = frame.lm[b];
        if (!pa || !pb) continue;
        if (pa.v < 0.3 || pb.v < 0.3) continue;
        ctx.beginPath();
        ctx.moveTo(toX(pa.x), toY(pa.y));
        ctx.lineTo(toX(pb.x), toY(pb.y));
        ctx.stroke();
      }
      for (let i = 11; i <= 32; i++) {
        const p = frame.lm[i];
        if (!p || p.v < 0.3) continue;
        ctx.beginPath();
        ctx.arc(toX(p.x), toY(p.y), 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Head dot
      const nose = frame.lm[0];
      if (nose && nose.v > 0.3) {
        ctx.beginPath();
        ctx.arc(toX(nose.x), toY(nose.y), 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    draw();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [choreo, phase, match]);

  if (!choreo) return null;
  if (phase !== "playing" && phase !== "countdown") return null;

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[15] flex flex-col items-end gap-1">
      <span className="rounded-full border border-fuchsia-400/60 bg-black/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-fuchsia-200 backdrop-blur">
        follow the dance
      </span>
      <canvas
        ref={canvasRef}
        className="rounded-xl border border-white/15 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
      />
    </div>
  );
}
