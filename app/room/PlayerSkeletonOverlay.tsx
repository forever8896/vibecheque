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
// When `graded` is true, color grades from cyan → green with live
// similarity so the player feels whether they're hitting the reference
// dancer's shape during a match.

// Match the calibration-gate skeleton so the ghost reads identically
// in both places.
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
  [24, 26],
  [26, 28],
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

    // Canvas CSS size is cached across frames — rAF hot path shouldn't
    // layout-read every tick. ResizeObserver updates these on actual
    // size changes only.
    let cssW = 0;
    let cssH = 0;

    function syncSize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      cssW = rect.width;
      cssH = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);

    let raf = 0;
    let cancelled = false;
    let lastDrawnUpdatedAt = -1;

    function loop() {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      if (!canvas || !ctx) return;

      const frame = localFrameRef.current;
      // Gate draws on new pose data so we don't redraw at 60 Hz when
      // MediaPipe only updates at ~30.
      if (!frame?.landmarks || frame.videoW <= 0 || frame.videoH <= 0) return;
      if (frame.updatedAt === lastDrawnUpdatedAt) return;
      lastDrawnUpdatedAt = frame.updatedAt;

      const toTile = makeLandmarkMapper(frame.videoW, frame.videoH, cssW, cssH);
      const lm = frame.landmarks;
      const mapX = (x: number) => 1 - x;

      let lineColor = "rgba(34, 211, 238, 0.9)";
      if (gradedRef.current) {
        const sim = Math.max(0, Math.min(1, frame.similarity ?? 0));
        const r = Math.round(34 * (1 - sim) + 74 * sim);
        const g = Math.round(211 * (1 - sim) + 222 * sim);
        const b = Math.round(238 * (1 - sim) + 128 * sim);
        lineColor = `rgba(${r}, ${g}, ${b}, 0.9)`;
      }

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = lineColor;
      // shadowBlur forces a slow Canvas2D path on most browsers. Skip it;
      // the solid cyan stroke reads fine on top of the dance video.

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
      for (let i = 11; i <= 32; i++) {
        const p = lm[i];
        if (!p || (p.visibility ?? 1) < 0.3) continue;
        const pt = toTile(mapX(p.x), p.y);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
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
  }, [localFrameRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[6] h-full w-full"
    />
  );
}
