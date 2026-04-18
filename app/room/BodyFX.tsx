"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "./SessionProvider";

// MediaPipe pose landmark connections (subset that reads as a body skeleton)
const CONNECTIONS: [number, number][] = [
  // torso
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  // arms
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  // hands
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  // legs
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
  // neck
  [0, 11],
  [0, 12],
];

// Local tile: glowing aura skeleton drawn from the pose landmarks
export function BodyAura() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { localFrameRef, phase } = useSession();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let cancelled = false;

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function draw() {
      if (cancelled) return;
      rafId = requestAnimationFrame(draw);
      if (!canvas || !ctx) return;

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const frame = localFrameRef.current;
      if (!frame || phase === "idle") return;

      const score = frame.score;
      const intensity = Math.max(0.35, Math.min(1, score / 100 + 0.3));
      const time = performance.now();
      const pulse = 0.85 + 0.15 * Math.sin(time / 200);
      const strength = intensity * pulse;

      const lm = frame.landmarks;
      // Video is mirrored with transform:scaleX(-1) — flip x so skeleton matches
      const toX = (x: number) => (1 - x) * w;
      const toY = (y: number) => y * h;

      const hue = (time / 40) % 360;
      const core = `hsla(${hue}, 100%, 70%, ${0.9 * strength})`;
      const glow = `hsla(${hue}, 100%, 60%, ${0.85 * strength})`;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // outer glow pass
      ctx.shadowBlur = 28 * strength;
      ctx.shadowColor = glow;
      ctx.strokeStyle = glow;
      ctx.lineWidth = 14 * strength;
      for (const [a, b] of CONNECTIONS) {
        const pa = lm[a];
        const pb = lm[b];
        if (!pa || !pb) continue;
        if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue;
        ctx.beginPath();
        ctx.moveTo(toX(pa.x), toY(pa.y));
        ctx.lineTo(toX(pb.x), toY(pb.y));
        ctx.stroke();
      }

      // inner bright pass
      ctx.shadowBlur = 8 * strength;
      ctx.strokeStyle = core;
      ctx.lineWidth = 4 * strength;
      for (const [a, b] of CONNECTIONS) {
        const pa = lm[a];
        const pb = lm[b];
        if (!pa || !pb) continue;
        if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue;
        ctx.beginPath();
        ctx.moveTo(toX(pa.x), toY(pa.y));
        ctx.lineTo(toX(pb.x), toY(pb.y));
        ctx.stroke();
      }

      // joint dots
      ctx.shadowBlur = 12 * strength;
      ctx.fillStyle = `hsla(${hue}, 100%, 85%, ${strength})`;
      for (let i = 11; i <= 32; i++) {
        const p = lm[i];
        if (!p) continue;
        if ((p.visibility ?? 1) < 0.3) continue;
        ctx.beginPath();
        ctx.arc(toX(p.x), toY(p.y), 3 * strength, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    draw();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [localFrameRef, phase]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
    />
  );
}

// Pop PERFECT/SUPER/GOOD words over the local tile when score crosses bands.
export function ScoreCallouts() {
  const { scores, phase, localFrameRef } = useSession();
  const [pops, setPops] = useState<
    { id: number; word: string; color: string; x: number; y: number }[]
  >([]);

  useEffect(() => {
    if (phase !== "playing") {
      setPops([]);
      return;
    }
    let lastBand = -1;
    let lastPopAt = 0;
    const id = setInterval(() => {
      // Use the local participant's score — we pull whichever value is freshest
      const frame = localFrameRef.current;
      const instant = frame?.score ?? 0;
      if (instant < 20) return;
      const now = performance.now();
      if (now - lastPopAt < 1200) return;

      let band = 0;
      let word = "GOOD";
      let color = "text-cyan-300";
      if (instant >= 80) {
        band = 3;
        word = "PERFECT";
        color = "text-fuchsia-300";
      } else if (instant >= 60) {
        band = 2;
        word = "SUPER";
        color = "text-amber-300";
      } else if (instant >= 40) {
        band = 1;
        word = "NICE";
        color = "text-emerald-300";
      }
      // Don't spam the same band; require a band change or a long gap
      if (band === lastBand && now - lastPopAt < 2400) return;

      lastBand = band;
      lastPopAt = now;

      // Position above the head if we have it, else top-center
      let x = 50;
      let y = 18;
      if (frame?.landmarks) {
        const nose = frame.landmarks[0];
        if (nose) {
          x = (1 - nose.x) * 100;
          y = Math.max(6, nose.y * 100 - 12);
        }
      }

      const popId = now;
      setPops((prev) => [...prev, { id: popId, word, color, x, y }].slice(-4));
      setTimeout(() => {
        setPops((prev) => prev.filter((p) => p.id !== popId));
      }, 1100);
    }, 300);
    return () => clearInterval(id);
  }, [phase, localFrameRef, scores]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[6] overflow-hidden">
      {pops.map((p) => (
        <div
          key={p.id}
          className={`absolute animate-[scoreRise_1.1s_ease-out_forwards] font-mono text-3xl font-bold uppercase tracking-widest drop-shadow-[0_0_20px_rgba(255,77,240,0.8)] ${p.color}`}
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          {p.word}
        </div>
      ))}
    </div>
  );
}

// Glow ring around every tile, intensity tied to that tile's score
export function TileAmbient({
  identity,
}: {
  identity: string | undefined;
}) {
  const { scores, phase } = useSession();
  const score = identity ? (scores.get(identity) ?? 0) : 0;
  const active = phase === "playing" || phase === "countdown";
  const intensity = active ? Math.min(1, score / 100) : 0;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[2] rounded-[inherit] transition-[box-shadow,opacity] duration-300"
      style={{
        boxShadow: `inset 0 0 ${40 + intensity * 80}px rgba(255, 77, 240, ${
          0.25 + intensity * 0.55
        }), 0 0 ${20 + intensity * 40}px rgba(255, 77, 240, ${
          0.15 + intensity * 0.5
        })`,
        opacity: active ? 1 : 0,
      }}
    />
  );
}

// CSS filter string to saturate + boost each tile's video during a match
export function tileVideoFilter(score: number, isLocal: boolean): string {
  const intensity = Math.min(1, score / 100);
  const sat = (isLocal ? 1.25 : 1.1) + 0.4 * intensity;
  const con = (isLocal ? 1.1 : 1.05) + 0.15 * intensity;
  const bri = (isLocal ? 1.03 : 1) + 0.05 * intensity;
  const hue = isLocal ? intensity * 15 : 0;
  return `saturate(${sat}) contrast(${con}) brightness(${bri}) hue-rotate(${hue}deg)`;
}
