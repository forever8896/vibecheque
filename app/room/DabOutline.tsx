"use client";

import { useEffect, useRef } from "react";
import { useSession } from "./SessionProvider";
import { assessDab } from "./dabPose";
import { makeLandmarkMapper } from "./landmarkMap";

// Dab silhouette drawn on the local player's tile during the idle-lobby
// phase. Anchors live to the player's shoulders so the ghost follows them
// around the frame at their scale, rather than floating at a fixed center.
// White-dashed while the pose doesn't match, solid green when it does.

type Anchor = {
  cx: number;
  cy: number;
  span: number; // tile-pixel shoulder span
};

// Silhouette offsets from the shoulder midpoint, expressed in multiples
// of the player's shoulder span so the figure stays body-proportional at
// any distance. Derived once from a reference 16:9 tile to preserve the
// prior look at 1× scale.
const BODY = {
  halfShoulder: 0.5,
  halfHip: 0.41,
  hipDy: 1.1,
  ankleDy: 2.29,
  headDy: -0.44,
  headR: 0.24,
  // Extended arm (person's left, drawing-right): reaches upper corner.
  lElbow: { dx: 1.35, dy: -0.79 },
  lWrist: { dx: 2.47, dy: -1.46 },
  // Bent arm (person's right, drawing-left): upper arm up-and-out, forearm
  // folds back across the face toward the extended-arm corner.
  rElbow: { dx: -1.06, dy: -0.62 },
  rWrist: { dx: -0.12, dy: -0.35 },
};

export function DabOutline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { localFrameRef, phase } = useSession();

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
    // Smoothed anchor in tile-pixel coords. Null until the player is seen.
    let smooth: Anchor | null = null;

    function loop() {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      if (!canvas || !ctx) return;
      if (phase !== "idle") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;

      const f = localFrameRef.current;
      const matched = f?.landmarks ? assessDab(f.landmarks).matched : false;

      // Pull the anchor from live shoulders via object-cover-aware mapping.
      const ls = f?.landmarks?.[11];
      const rs = f?.landmarks?.[12];
      const shouldersOk =
        !!f &&
        !!ls &&
        !!rs &&
        (ls.visibility ?? 0) > 0.4 &&
        (rs.visibility ?? 0) > 0.4 &&
        f.videoW > 0 &&
        f.videoH > 0;
      if (shouldersOk && f && ls && rs) {
        const toTile = makeLandmarkMapper(f.videoW, f.videoH, W, H);
        const lsT = toTile(ls.x, ls.y);
        const rsT = toTile(rs.x, rs.y);
        const tgt: Anchor = {
          cx: (lsT.x + rsT.x) / 2,
          cy: (lsT.y + rsT.y) / 2,
          span: Math.abs(lsT.x - rsT.x),
        };
        if (!smooth) {
          smooth = tgt;
        } else {
          const a = 0.2;
          smooth = {
            cx: smooth.cx * (1 - a) + tgt.cx * a,
            cy: smooth.cy * (1 - a) + tgt.cy * a,
            span: smooth.span * (1 - a) + tgt.span * a,
          };
        }
      }

      ctx.clearRect(0, 0, W, H);
      const anchor =
        smooth ?? {
          cx: W / 2,
          cy: H * 0.4,
          span: W * 0.17,
        };
      drawDabTarget(ctx, W, H, matched, anchor);
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
  anchor: Anchor,
) {
  // Clamp span so the silhouette stays legible at extremes (player crammed
  // up to the camera or barely in frame).
  const minSpan = Math.min(W, H) * 0.08;
  const maxSpan = Math.min(W, H) * 0.55;
  const span = Math.max(minSpan, Math.min(maxSpan, anchor.span));
  const cx = anchor.cx;
  const sy = anchor.cy;

  const pt = (dx: number, dy: number) => ({
    x: cx + dx * span,
    y: sy + dy * span,
  });

  const lShoulder = pt(+BODY.halfShoulder, 0);
  const rShoulder = pt(-BODY.halfShoulder, 0);
  const lHip = pt(+BODY.halfHip, BODY.hipDy);
  const rHip = pt(-BODY.halfHip, BODY.hipDy);
  const lAnkle = pt(+BODY.halfHip, BODY.ankleDy);
  const rAnkle = pt(-BODY.halfHip, BODY.ankleDy);
  const lElbow = pt(BODY.lElbow.dx, BODY.lElbow.dy);
  const lWrist = pt(BODY.lWrist.dx, BODY.lWrist.dy);
  const rElbow = pt(BODY.rElbow.dx, BODY.rElbow.dy);
  const rWrist = pt(BODY.rWrist.dx, BODY.rWrist.dy);
  const headC = pt(0, BODY.headDy);
  const headR = span * BODY.headR;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, span * 0.055);
  ctx.strokeStyle = matched
    ? "rgba(74, 222, 128, 0.95)"
    : "rgba(255, 255, 255, 0.75)";
  ctx.shadowColor = matched
    ? "rgba(74, 222, 128, 0.8)"
    : "rgba(255, 255, 255, 0.35)";
  ctx.shadowBlur = matched ? 18 : 10;
  if (!matched) ctx.setLineDash([10, 8]);

  ctx.beginPath();
  ctx.moveTo(lShoulder.x, lShoulder.y);
  ctx.lineTo(rShoulder.x, rShoulder.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(lShoulder.x, lShoulder.y);
  ctx.lineTo(lHip.x, lHip.y);
  ctx.moveTo(rShoulder.x, rShoulder.y);
  ctx.lineTo(rHip.x, rHip.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(lHip.x, lHip.y);
  ctx.lineTo(rHip.x, rHip.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(lHip.x, lHip.y);
  ctx.lineTo(lAnkle.x, lAnkle.y);
  ctx.moveTo(rHip.x, rHip.y);
  ctx.lineTo(rAnkle.x, rAnkle.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(lShoulder.x, lShoulder.y);
  ctx.lineTo(lElbow.x, lElbow.y);
  ctx.lineTo(lWrist.x, lWrist.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(rShoulder.x, rShoulder.y);
  ctx.lineTo(rElbow.x, rElbow.y);
  ctx.lineTo(rWrist.x, rWrist.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(headC.x, headC.y, headR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
