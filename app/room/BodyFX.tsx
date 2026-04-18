"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "./SessionProvider";

// Per-limb colors for the skeleton overlay
type LimbGroup = { color: string; connections: [number, number][] };
const LIMB_GROUPS: LimbGroup[] = [
  // person's left arm
  {
    color: "#22d3ee",
    connections: [
      [11, 13],
      [13, 15],
      [15, 17],
      [15, 19],
    ],
  },
  // person's right arm
  {
    color: "#facc15",
    connections: [
      [12, 14],
      [14, 16],
      [16, 18],
      [16, 20],
    ],
  },
  // left leg
  {
    color: "#ff4df0",
    connections: [
      [23, 25],
      [25, 27],
      [27, 31],
    ],
  },
  // right leg
  {
    color: "#4ade80",
    connections: [
      [24, 26],
      [26, 28],
      [28, 32],
    ],
  },
  // torso + neck
  {
    color: "#ffffff",
    connections: [
      [11, 12],
      [11, 23],
      [12, 24],
      [23, 24],
      [0, 11],
      [0, 12],
    ],
  },
];

// Lightweight single-pass skeleton: one stroke with a glow per limb
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
    let lastTs = 0;

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

      // Cap at 30fps
      const now = performance.now();
      if (now - lastTs < 33) return;
      lastTs = now;

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      if (phase === "idle") return;

      const frame = localFrameRef.current;
      if (!frame) return;

      const lm = frame.landmarks;
      const intensity = Math.max(
        0.4,
        Math.min(1, frame.score / 100 + 0.4),
      );

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 5 * intensity;
      ctx.shadowBlur = 14 * intensity;

      for (const group of LIMB_GROUPS) {
        ctx.strokeStyle = group.color;
        ctx.shadowColor = group.color;
        for (const [a, b] of group.connections) {
          const pa = lm[a];
          const pb = lm[b];
          if (!pa || !pb) continue;
          if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3)
            continue;
          ctx.beginPath();
          ctx.moveTo(pa.x * w, pa.y * h);
          ctx.lineTo(pb.x * w, pb.y * h);
          ctx.stroke();
        }
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

// Per-tile live USDC flow pill (green when winning, red when losing)
export function FlowPill({ identity }: { identity: string | undefined }) {
  const { flowRates, winnings, phase } = useSession();
  if (!identity) return null;
  if (phase !== "playing" && phase !== "ended") return null;

  const rate = flowRates.get(identity) ?? 0;
  const net = winnings.get(identity) ?? 0;
  const winning = rate > 0;
  const losing = rate < 0;

  const rateLabel =
    rate === 0
      ? "•"
      : `${winning ? "+" : ""}$${Math.abs(rate).toFixed(3)}/s`;
  const netLabel = `${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(2)}`;

  return (
    <div
      className={`pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest backdrop-blur transition ${
        winning
          ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
          : losing
            ? "border-rose-400/60 bg-rose-500/20 text-rose-200"
            : "border-white/10 bg-black/70 text-zinc-300"
      }`}
    >
      <span>{winning ? "↑" : losing ? "↓" : "•"}</span>
      <span className="tabular-nums">{rateLabel}</span>
      <span className="tabular-nums opacity-70">{netLabel}</span>
    </div>
  );
}

// Vibrant Just Dance-style palette for per-player tints
const TINT_PALETTE = [
  "#ff4df0", // fuchsia
  "#22d3ee", // cyan
  "#facc15", // amber
  "#4ade80", // green
  "#fb923c", // orange
  "#a78bfa", // violet
];

export function tintForIdentity(identity: string | undefined): string {
  if (!identity) return TINT_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < identity.length; i++) {
    hash = (hash * 31 + identity.charCodeAt(i)) | 0;
  }
  return TINT_PALETTE[Math.abs(hash) % TINT_PALETTE.length];
}

export function PlayerTint({
  identity,
  active,
}: {
  identity: string | undefined;
  active: boolean;
}) {
  const color = tintForIdentity(identity);
  return (
    <>
      {/* "color" blend keeps video luminance but swaps hue+saturation */}
      <div
        className="pointer-events-none absolute inset-0 z-[4] transition-opacity duration-300"
        style={{
          backgroundColor: color,
          mixBlendMode: "color",
          opacity: active ? 0.7 : 0.45,
        }}
      />
      {/* Subtle multiply boost to deepen shadows in that hue */}
      <div
        className="pointer-events-none absolute inset-0 z-[4] transition-opacity duration-300"
        style={{
          backgroundColor: color,
          mixBlendMode: "soft-light",
          opacity: active ? 0.35 : 0.2,
        }}
      />
      {/* Colored edge ring that matches the player */}
      <div
        className="pointer-events-none absolute inset-0 z-[4] rounded-[inherit] transition-[box-shadow] duration-300"
        style={{
          boxShadow: active
            ? `inset 0 0 80px ${color}80, 0 0 30px ${color}60`
            : `inset 0 0 40px ${color}40`,
        }}
      />
    </>
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
