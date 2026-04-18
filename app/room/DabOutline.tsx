"use client";

import { useEffect, useRef } from "react";
import { useSession } from "./SessionProvider";
import { assessDab } from "./dabPose";

// Dab silhouette drawn on the local player's tile during the idle-lobby
// phase. Same visual grammar as the T-pose calibration target: white dashed
// while unmatched, solid green while matched, so the player sees what pose
// the start-gate is looking for. The canvas lives inside the tile's
// mirror-wrapper, so silhouette coordinates are authored in "post-mirror"
// tile space (drawing-right = what the player sees on their right).

export function DabOutline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { localFrameRef, phase } = useSession();
  const matchedRef = useRef(false);

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
      if (phase !== "idle") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const f = localFrameRef.current;
      const matched = f?.landmarks ? assessDab(f.landmarks).matched : false;
      matchedRef.current = matched;

      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      ctx.clearRect(0, 0, W, H);
      drawDabTarget(ctx, W, H, matched);
    }
    loop();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [localFrameRef, phase]);

  if (phase !== "idle") return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[4] h-full w-full"
    />
  );
}

function drawDabTarget(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  matched: boolean,
) {
  // Coordinates are authored in the mirrored tile view — the player sees
  // themselves mirror-flipped, so "left arm up-right on screen" reads to
  // the player as "raise my own left arm up-to-my-right."
  const cx = W / 2;
  const shoulderY = H * 0.4;
  const hipY = H * 0.65;
  const halfSpan = W * 0.085;
  const halfHipSpan = W * 0.07;

  const lShoulder = { x: cx + halfSpan, y: shoulderY };
  const rShoulder = { x: cx - halfSpan, y: shoulderY };
  const lHip = { x: cx + halfHipSpan, y: hipY };
  const rHip = { x: cx - halfHipSpan, y: hipY };
  const lAnkle = { x: cx + halfHipSpan, y: H * 0.92 };
  const rAnkle = { x: cx - halfHipSpan, y: H * 0.92 };

  // Extended arm: person's-left arm out-and-up to their left (drawing-right)
  const lElbow = { x: cx + W * 0.22, y: shoulderY - H * 0.13 };
  const lWrist = { x: cx + W * 0.33, y: shoulderY - H * 0.24 };

  // Bent arm: person's-right upper arm swung across to the extended side
  // (elbow well past center) so the forearm can come back UP toward the
  // face, forming the sharp V that defines a dab. Elbow near shoulder
  // height, wrist up at forehead level slightly inboard of the elbow.
  const rElbow = { x: cx + W * 0.14, y: shoulderY - H * 0.005 };
  const rWrist = { x: cx + W * 0.08, y: shoulderY - H * 0.2 };

  const headY = shoulderY - H * 0.1;
  const headR = H * 0.055;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, H * 0.008);
  ctx.strokeStyle = matched
    ? "rgba(74, 222, 128, 0.95)"
    : "rgba(255, 255, 255, 0.75)";
  ctx.shadowColor = matched
    ? "rgba(74, 222, 128, 0.8)"
    : "rgba(255, 255, 255, 0.35)";
  ctx.shadowBlur = matched ? 18 : 10;
  if (!matched) ctx.setLineDash([10, 8]);

  // Shoulders
  ctx.beginPath();
  ctx.moveTo(lShoulder.x, lShoulder.y);
  ctx.lineTo(rShoulder.x, rShoulder.y);
  ctx.stroke();

  // Torso sides
  ctx.beginPath();
  ctx.moveTo(lShoulder.x, lShoulder.y);
  ctx.lineTo(lHip.x, lHip.y);
  ctx.moveTo(rShoulder.x, rShoulder.y);
  ctx.lineTo(rHip.x, rHip.y);
  ctx.stroke();

  // Hips
  ctx.beginPath();
  ctx.moveTo(lHip.x, lHip.y);
  ctx.lineTo(rHip.x, rHip.y);
  ctx.stroke();

  // Legs
  ctx.beginPath();
  ctx.moveTo(lHip.x, lHip.y);
  ctx.lineTo(lAnkle.x, lAnkle.y);
  ctx.moveTo(rHip.x, rHip.y);
  ctx.lineTo(rAnkle.x, rAnkle.y);
  ctx.stroke();

  // Extended arm (shoulder → elbow → wrist)
  ctx.beginPath();
  ctx.moveTo(lShoulder.x, lShoulder.y);
  ctx.lineTo(lElbow.x, lElbow.y);
  ctx.lineTo(lWrist.x, lWrist.y);
  ctx.stroke();

  // Bent arm (shoulder → elbow → wrist)
  ctx.beginPath();
  ctx.moveTo(rShoulder.x, rShoulder.y);
  ctx.lineTo(rElbow.x, rElbow.y);
  ctx.lineTo(rWrist.x, rWrist.y);
  ctx.stroke();

  // Head
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
