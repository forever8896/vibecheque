"use client";

import { useEffect, useRef } from "react";
import { useSession } from "./SessionProvider";
import { makeLandmarkMapper } from "./landmarkMap";

// Draws the local player's MediaPipe skeleton on top of whatever is
// behind it (the LobbyPreview reference video in idle, or the
// ReferenceVideoStage video during active play). Mirror-flipped in x
// so the player reads themselves as if in a mirror against the
// unmirrored dancer.
//
// When `graded` is true, color grades from pink → green with the live
// similarity score, so the player feels whether they're hitting the
// reference dancer's shape during a match.

const SKELETON_CONNS: [number, number][] = [
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

export function PlayerSkeletonOverlay({
  graded = false,
}: {
  graded?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { localFrameRef } = useSession();
  const gradedRef = useRef(graded);
  useEffect(() => {
    gradedRef.current = graded;
  }, [graded]);

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

      const frame = localFrameRef.current;
      if (!frame?.landmarks || frame.videoW <= 0 || frame.videoH <= 0) return;

      const toTile = makeLandmarkMapper(
        frame.videoW,
        frame.videoH,
        W,
        H,
      );
      const lm = frame.landmarks;
      const mapX = (x: number) => 1 - x;

      let lineColor = "rgba(255, 77, 240, 0.95)";
      let shadow = "rgba(255, 77, 240, 0.85)";
      if (gradedRef.current) {
        const sim = Math.max(0, Math.min(1, frame.similarity ?? 0));
        const r = Math.round(255 * (1 - sim) + 74 * sim);
        const g = Math.round(77 * (1 - sim) + 222 * sim);
        const b = Math.round(240 * (1 - sim) + 128 * sim);
        lineColor = `rgba(${r}, ${g}, ${b}, 0.95)`;
        shadow = `rgba(${r}, ${g}, ${b}, 0.85)`;
      }

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(4, Math.min(W, H) * 0.012);
      ctx.strokeStyle = lineColor;
      ctx.shadowColor = shadow;
      ctx.shadowBlur = 18;

      for (const [a, b2] of SKELETON_CONNS) {
        const pa = lm[a];
        const pb = lm[b2];
        if (!pa || !pb) continue;
        if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue;
        const paT = toTile(mapX(pa.x), pa.y);
        const pbT = toTile(mapX(pb.x), pb.y);
        ctx.beginPath();
        ctx.moveTo(paT.x, paT.y);
        ctx.lineTo(pbT.x, pbT.y);
        ctx.stroke();
      }

      ctx.fillStyle = lineColor;
      ctx.shadowBlur = 10;
      const jointR = Math.max(3, Math.min(W, H) * 0.008);
      for (let i = 11; i <= 32; i++) {
        const p = lm[i];
        if (!p || (p.visibility ?? 1) < 0.3) continue;
        const pt = toTile(mapX(p.x), p.y);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, jointR, 0, Math.PI * 2);
        ctx.fill();
      }

      const nose = lm[0];
      const ls = lm[11];
      const rs = lm[12];
      if (
        nose &&
        ls &&
        rs &&
        (nose.visibility ?? 1) > 0.3 &&
        (ls.visibility ?? 1) > 0.3 &&
        (rs.visibility ?? 1) > 0.3
      ) {
        const nT = toTile(mapX(nose.x), nose.y);
        const lsT = toTile(mapX(ls.x), ls.y);
        const rsT = toTile(mapX(rs.x), rs.y);
        const shoulderSpanPx = Math.hypot(lsT.x - rsT.x, lsT.y - rsT.y);
        ctx.lineWidth = Math.max(3, shoulderSpanPx * 0.04);
        ctx.shadowBlur = 14;
        ctx.strokeStyle = lineColor;
        ctx.beginPath();
        ctx.arc(
          nT.x,
          nT.y,
          Math.max(10, shoulderSpanPx * 0.45),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }

      ctx.restore();
    }
    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [localFrameRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[6] h-full w-full"
    />
  );
}
