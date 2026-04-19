"use client";

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";
import { makeLandmarkMapper } from "@/app/room/landmarkMap";

type Status =
  | "loading"
  | "requesting-camera"
  | "no-body"
  | "center-yourself"
  | "step-closer"
  | "step-back"
  | "tpose-arms"
  | "hold-still"
  | "ready"
  | "error";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// All thresholds in normalized source-video coords
const MIN_TORSO_HEIGHT = 0.14;
const MAX_TORSO_HEIGHT = 0.55;
const CENTER_TOLERANCE = 0.2;
const ARM_H_MIN = 0.18; // wrist reaches this far horizontally from shoulder
const ARM_V_MAX = 0.08; // wrists within ±8% frame-height of shoulder Y
const ELBOW_V_MAX = 0.09; // elbows also roughly at shoulder height
const SHOULDER_LEVEL_MAX = 0.06; // shoulder line must be roughly horizontal
const HOLD_FRAMES = 25;

function assessPose(lm: NormalizedLandmark[]): {
  shouldersVisible: boolean;
  hipsVisible: boolean;
  armsOut: boolean;
  torsoHeight: number;
  midX: number;
} {
  const ls = lm[11];
  const rs = lm[12];
  const lh = lm[23];
  const rh = lm[24];
  const le = lm[13];
  const re = lm[14];
  const lw = lm[15];
  const rw = lm[16];
  const shouldersVisible =
    (ls?.visibility ?? 0) > 0.55 && (rs?.visibility ?? 0) > 0.55;
  const hipsVisible =
    (lh?.visibility ?? 0) > 0.45 && (rh?.visibility ?? 0) > 0.45;
  const midX = ls && rs ? (ls.x + rs.x) / 2 : 0.5;
  const shoulderY = ls && rs ? (ls.y + rs.y) / 2 : 0;
  const torsoHeight =
    ls && rs && lh && rh
      ? Math.abs(((lh.y + rh.y) / 2) - shoulderY)
      : 0;
  // person's left arm = landmarks 11 (shoulder) to 15 (wrist); in camera
  // coords the wrist extends further +x than the shoulder
  const leftArmDx = ls && lw ? lw.x - ls.x : 0;
  const leftArmDy = lw ? Math.abs(lw.y - shoulderY) : 1;
  const rightArmDx = rs && rw ? rs.x - rw.x : 0;
  const rightArmDy = rw ? Math.abs(rw.y - shoulderY) : 1;
  const leftElbowDx = ls && le ? le.x - ls.x : 0;
  const leftElbowDy = le ? Math.abs(le.y - shoulderY) : 1;
  const rightElbowDx = rs && re ? rs.x - re.x : 0;
  const rightElbowDy = re ? Math.abs(re.y - shoulderY) : 1;
  const jointsVisible =
    (lw?.visibility ?? 0) > 0.4 &&
    (rw?.visibility ?? 0) > 0.4 &&
    (le?.visibility ?? 0) > 0.4 &&
    (re?.visibility ?? 0) > 0.4;
  const shouldersLevel =
    ls && rs ? Math.abs(ls.y - rs.y) < SHOULDER_LEVEL_MAX : false;
  const armsOut =
    jointsVisible &&
    shouldersLevel &&
    // Wrists fully extended outward at shoulder height
    leftArmDx > ARM_H_MIN &&
    rightArmDx > ARM_H_MIN &&
    leftArmDy < ARM_V_MAX &&
    rightArmDy < ARM_V_MAX &&
    // Elbows between shoulder and wrist horizontally, at shoulder height
    leftElbowDx > ARM_H_MIN * 0.35 &&
    leftElbowDx < leftArmDx &&
    rightElbowDx > ARM_H_MIN * 0.35 &&
    rightElbowDx < rightArmDx &&
    leftElbowDy < ELBOW_V_MAX &&
    rightElbowDy < ELBOW_V_MAX;
  return { shouldersVisible, hipsVisible, armsOut, torsoHeight, midX };
}

export function CalibrationGate({ onReady }: { onReady: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const firedRef = useRef(false);
  const [status, setStatus] = useState<Status>("loading");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let landmarker: PoseLandmarker | null = null;
    let stream: MediaStream | null = null;
    let lastTs = 0;
    let holdCount = 0;
    const startedAt = performance.now();
    let lastLandmarks: NormalizedLandmark[] | null = null;
    let lastVideoSize = { w: 0, h: 0 };
    let armsMatched = false;

    async function init() {
      try {
        setStatus("requesting-camera");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        if (cancelled) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((err: Error) => {
            if (err.name !== "AbortError") {
              console.warn("[calibration] play failed", err);
            }
          });
        }
        const resolver = await FilesetResolver.forVisionTasks(WASM_BASE);
        landmarker = await PoseLandmarker.createFromOptions(resolver, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        if (cancelled) return;
        setStatus("no-body");
        loop();
      } catch (err) {
        console.error("[calibration] init failed", err);
        setStatus("error");
      }
    }

    function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !landmarker) return;

      const ts = performance.now();
      if (ts - lastTs < 33) return;
      lastTs = ts;
      setElapsedMs(ts - startedAt);

      let result;
      try {
        result = landmarker.detectForVideo(video, ts);
      } catch {
        return;
      }
      const lm = result.landmarks?.[0] as NormalizedLandmark[] | undefined;
      lastVideoSize = { w: video.videoWidth, h: video.videoHeight };
      if (!lm) {
        lastLandmarks = null;
        armsMatched = false;
        setStatus("no-body");
        holdCount = 0;
        setHoldProgress(0);
        redraw();
        return;
      }
      lastLandmarks = lm;

      const a = assessPose(lm);
      if (!a.shouldersVisible) {
        armsMatched = false;
        setStatus("no-body");
        holdCount = 0;
        setHoldProgress(0);
        redraw();
        return;
      }
      if (Math.abs(a.midX - 0.5) > CENTER_TOLERANCE) {
        armsMatched = false;
        setStatus("center-yourself");
        holdCount = 0;
        setHoldProgress(0);
        redraw();
        return;
      }
      if (!a.hipsVisible) {
        armsMatched = false;
        setStatus("step-back");
        holdCount = 0;
        setHoldProgress(0);
        redraw();
        return;
      }
      if (a.torsoHeight < MIN_TORSO_HEIGHT) {
        armsMatched = false;
        setStatus("step-closer");
        holdCount = 0;
        setHoldProgress(0);
        redraw();
        return;
      }
      if (a.torsoHeight > MAX_TORSO_HEIGHT) {
        armsMatched = false;
        setStatus("step-back");
        holdCount = 0;
        setHoldProgress(0);
        redraw();
        return;
      }
      if (!a.armsOut) {
        armsMatched = false;
        setStatus("tpose-arms");
        holdCount = 0;
        setHoldProgress(0);
        redraw();
        return;
      }

      // Full match — distance, centering, and arms all good
      armsMatched = true;
      holdCount++;
      setHoldProgress(Math.min(1, holdCount / HOLD_FRAMES));
      setStatus(holdCount >= HOLD_FRAMES ? "ready" : "hold-still");
      redraw();

      if (holdCount >= HOLD_FRAMES && !firedRef.current) {
        firedRef.current = true;
        setStatus("ready");
        onReady();
      }
    }

    function redraw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      if (canvas.width !== W * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, W, H);

      drawTposeTarget(ctx, W, H, armsMatched);

      if (lastLandmarks && lastVideoSize.w > 0 && lastVideoSize.h > 0) {
        drawUserSkeleton(
          ctx,
          lastLandmarks,
          W,
          H,
          lastVideoSize.w,
          lastVideoSize.h,
        );
      }
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      landmarker?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onReady]);

  const headline: Record<Status, string> = {
    loading: "Booting…",
    "requesting-camera": "Allow camera access",
    "no-body": "Step into view",
    "center-yourself": "Center yourself",
    "step-closer": "Step closer",
    "step-back": "Step back",
    "tpose-arms": "Make a T-pose",
    "hold-still": "Hold it…",
    ready: "Calibrated",
    error: "Camera blocked",
  };

  return (
    <>
      <div className="fixed inset-0 z-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
          muted
          playsInline
        />
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_15%,rgba(0,0,0,0.85)_85%)]" />
      </div>

      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-10 h-full w-full [transform:scaleX(-1)]"
      />

      <div className="pointer-events-none fixed inset-x-0 top-10 z-30 flex flex-col items-center gap-3 px-4 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300/80">
          step 2 · calibration
        </p>
        <h2
          className={`font-mono font-semibold uppercase leading-tight transition-all duration-500 ${
            status === "ready"
              ? "text-3xl text-emerald-300 drop-shadow-[0_0_25px_rgba(74,222,128,0.6)] md:text-5xl"
              : "text-2xl text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)] md:text-4xl"
          }`}
        >
          {headline[status]}
        </h2>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
          match the dashed T-pose so we can size you up
        </p>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-10 z-30 flex justify-center">
        {status === "hold-still" || status === "ready" ? (
          <div className="relative h-2 w-48 overflow-hidden rounded-full border border-white/15 bg-black/60">
            <div
              className={`absolute inset-y-0 left-0 transition-[width] duration-150 ${
                status === "ready" ? "bg-emerald-300" : "bg-fuchsia-400"
              }`}
              style={{ width: `${Math.round(holdProgress * 100)}%` }}
            />
          </div>
        ) : (
          elapsedMs > 6000 && (
            <button
              onClick={() => {
                if (firedRef.current) return;
                firedRef.current = true;
                onReady();
              }}
              className="pointer-events-auto rounded-full border border-white/20 bg-black/60 px-4 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400 hover:text-white"
            >
              skip calibration
            </button>
          )
        )}
      </div>
    </>
  );
}

// -- drawing helpers ---------------------------------------------------

function drawTposeTarget(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  matched: boolean,
) {
  // Fixed T-pose silhouette centered in the frame. Arms extend to ~20%/80%
  // of width so the player needs to be roughly at the calibrated distance
  // for their wrists to reach the target marks.
  const cx = W / 2;
  const shoulderY = H * 0.33;
  const hipY = H * 0.6;
  const wristL = { x: W * 0.82, y: shoulderY }; // visually left (mirrored)
  const wristR = { x: W * 0.18, y: shoulderY };
  const shoulderL = { x: cx + W * 0.04, y: shoulderY };
  const shoulderR = { x: cx - W * 0.04, y: shoulderY };
  const hipL = { x: cx + W * 0.035, y: hipY };
  const hipR = { x: cx - W * 0.035, y: hipY };
  const ankleL = { x: cx + W * 0.04, y: H * 0.9 };
  const ankleR = { x: cx - W * 0.04, y: H * 0.9 };
  const headY = shoulderY - H * 0.08;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = matched
    ? "rgba(74, 222, 128, 0.95)"
    : "rgba(255, 255, 255, 0.6)";
  ctx.shadowColor = matched
    ? "rgba(74, 222, 128, 0.8)"
    : "rgba(255, 255, 255, 0.3)";
  ctx.shadowBlur = matched ? 16 : 10;
  if (!matched) ctx.setLineDash([10, 8]);

  // Arms (T)
  ctx.beginPath();
  ctx.moveTo(wristR.x, wristR.y);
  ctx.lineTo(wristL.x, wristL.y);
  ctx.stroke();

  // Torso
  ctx.beginPath();
  ctx.moveTo(shoulderL.x, shoulderL.y);
  ctx.lineTo(hipL.x, hipL.y);
  ctx.moveTo(shoulderR.x, shoulderR.y);
  ctx.lineTo(hipR.x, hipR.y);
  ctx.stroke();

  // Hip line + shoulder line
  ctx.beginPath();
  ctx.moveTo(shoulderL.x, shoulderL.y);
  ctx.lineTo(shoulderR.x, shoulderR.y);
  ctx.moveTo(hipL.x, hipL.y);
  ctx.lineTo(hipR.x, hipR.y);
  ctx.stroke();

  // Legs
  ctx.beginPath();
  ctx.moveTo(hipL.x, hipL.y);
  ctx.lineTo(ankleL.x, ankleL.y);
  ctx.moveTo(hipR.x, hipR.y);
  ctx.lineTo(ankleR.x, ankleR.y);
  ctx.stroke();

  // Head
  ctx.beginPath();
  ctx.arc(cx, headY, H * 0.05, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawUserSkeleton(
  ctx: CanvasRenderingContext2D,
  lm: NormalizedLandmark[],
  W: number,
  H: number,
  videoW: number,
  videoH: number,
) {
  const toTile = makeLandmarkMapper(videoW, videoH, W, H);
  const CONNS: [number, number][] = [
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
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(34, 211, 238, 0.9)";
  ctx.shadowColor = "rgba(34, 211, 238, 0.8)";
  ctx.shadowBlur = 12;
  for (const [a, b] of CONNS) {
    const pa = lm[a];
    const pb = lm[b];
    if (!pa || !pb) continue;
    if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue;
    const paT = toTile(pa.x, pa.y);
    const pbT = toTile(pb.x, pb.y);
    ctx.beginPath();
    ctx.moveTo(paT.x, paT.y);
    ctx.lineTo(pbT.x, pbT.y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(34, 211, 238, 0.9)";
  ctx.shadowBlur = 8;
  for (let i = 11; i <= 32; i++) {
    const p = lm[i];
    if (!p || (p.visibility ?? 1) < 0.3) continue;
    const pt = toTile(p.x, p.y);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
