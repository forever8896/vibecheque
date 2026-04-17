"use client";

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";

type Status =
  | "loading"
  | "requesting-camera"
  | "no-face"
  | "face-no-glasses"
  | "pass"
  | "error";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const LEFT_EYE = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
];
const RIGHT_EYE = [
  362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384,
  398,
];
const FACE_REF = [10, 109, 338, 67, 297, 205, 425, 152];

const PASS_FRAMES = 8;
const FAIL_FRAMES = 12;
const CONTRAST_THRESHOLD = 22;
const EYE_MAX_BRIGHTNESS = 85;
const MANUAL_OVERRIDE_AFTER_MS = 10_000;

function clearOverlay(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawOverlay(
  canvas: HTMLCanvasElement | null,
  videoW: number,
  videoH: number,
  lm: { x: number; y: number }[],
  elapsedMs: number,
  glow: number,
) {
  if (!canvas) return;
  if (canvas.width !== videoW) canvas.width = videoW;
  if (canvas.height !== videoH) canvas.height = videoH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (glow < 0.02) return;

  const pulse = 0.96 + 0.04 * Math.sin(elapsedMs / 700);
  const strength = glow * pulse;

  const leftCenter = centerOf(canvas, lm, LEFT_EYE);
  const rightCenter = centerOf(canvas, lm, RIGHT_EYE);
  const faceCenter = {
    x: (leftCenter.x + rightCenter.x) / 2,
    y: (leftCenter.y + rightCenter.y) / 2,
  };

  drawSunburst(ctx, canvas, faceCenter, elapsedMs, strength);
  drawEyeGlow(ctx, canvas, lm, LEFT_EYE, strength);
  drawEyeGlow(ctx, canvas, lm, RIGHT_EYE, strength);
}

function drawSunburst(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  center: { x: number; y: number },
  elapsedMs: number,
  strength: number,
) {
  if (strength <= 0.02) return;
  // Reach any corner from any face position
  const maxCornerDist = Math.max(
    Math.hypot(center.x, center.y),
    Math.hypot(canvas.width - center.x, center.y),
    Math.hypot(center.x, canvas.height - center.y),
    Math.hypot(canvas.width - center.x, canvas.height - center.y),
  );
  const reach = maxCornerDist * 1.1;

  const NUM = 16;
  const rotation = (elapsedMs / 24000) * Math.PI * 2;
  const flicker = 1;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < NUM; i++) {
    const angle = rotation + (i / NUM) * Math.PI * 2;
    const thick = i % 2 === 0;
    const halfAngle = thick ? 0.14 : 0.045;
    const rayStrength = strength * flicker * (thick ? 1 : 0.7);

    const grad = ctx.createRadialGradient(
      center.x,
      center.y,
      0,
      center.x,
      center.y,
      reach,
    );
    grad.addColorStop(0, `rgba(255, 200, 255, ${0.9 * rayStrength})`);
    grad.addColorStop(0.08, `rgba(255, 120, 240, ${0.75 * rayStrength})`);
    grad.addColorStop(0.45, `rgba(255, 77, 240, ${0.28 * rayStrength})`);
    grad.addColorStop(1, "rgba(255, 77, 240, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(
      center.x + Math.cos(angle - halfAngle) * reach,
      center.y + Math.sin(angle - halfAngle) * reach,
    );
    ctx.lineTo(
      center.x + Math.cos(angle + halfAngle) * reach,
      center.y + Math.sin(angle + halfAngle) * reach,
    );
    ctx.closePath();
    ctx.fill();
  }

  // Soft center glow so the rays visibly converge at the face
  const centerGrad = ctx.createRadialGradient(
    center.x,
    center.y,
    0,
    center.x,
    center.y,
    reach * 0.25,
  );
  centerGrad.addColorStop(0, `rgba(255, 200, 255, ${0.5 * strength})`);
  centerGrad.addColorStop(1, "rgba(255, 77, 240, 0)");
  ctx.fillStyle = centerGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.restore();
}

function drawEyeGlow(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  lm: { x: number; y: number }[],
  indices: number[],
  strength: number,
) {
  if (strength <= 0) return;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < indices.length; i++) {
    const p = lm[indices[i]];
    if (!p) continue;
    const x = p.x * canvas.width;
    const y = p.y * canvas.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  ctx.shadowBlur = 40 * strength;
  ctx.shadowColor = "rgba(255, 77, 240, 0.95)";
  ctx.strokeStyle = `rgba(255, 77, 240, ${0.95 * strength})`;
  ctx.lineWidth = 6 * strength;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * strength})`;
  ctx.lineWidth = 2 * strength;
  ctx.stroke();

  ctx.restore();
}

function centerOf(
  canvas: HTMLCanvasElement,
  lm: { x: number; y: number }[],
  indices: number[],
) {
  let sx = 0,
    sy = 0,
    n = 0;
  for (const i of indices) {
    const p = lm[i];
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    n++;
  }
  return {
    x: (sx / Math.max(1, n)) * canvas.width,
    y: (sy / Math.max(1, n)) * canvas.height,
  };
}

function sampleBrightness(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  lm: { x: number; y: number }[],
  indices: number[],
): number {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const i of indices) {
    const p = lm[i];
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return 0;

  const x = Math.max(0, Math.floor(minX * canvas.width));
  const y = Math.max(0, Math.floor(minY * canvas.height));
  const w = Math.min(
    canvas.width - x,
    Math.max(1, Math.ceil((maxX - minX) * canvas.width)),
  );
  const h = Math.min(
    canvas.height - y,
    Math.max(1, Math.ceil((maxY - minY) * canvas.height)),
  );
  if (w <= 0 || h <= 0) return 0;

  const { data } = ctx.getImageData(x, y, w, h);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    n++;
  }
  return n ? sum / n : 0;
}

export function SunglassesGate({
  onStatusChange,
}: {
  onStatusChange: (passed: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef(0);
  const manualOverrideRef = useRef(false);
  const lastLandmarksRef = useRef<{ x: number; y: number }[] | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [eyeB, setEyeB] = useState(0);
  const [faceB, setFaceB] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [manuallyOverridden, setManuallyOverridden] = useState(false);

  useEffect(() => {
    let landmarker: FaceLandmarker | null = null;
    let stream: MediaStream | null = null;
    let rafId = 0;
    let cancelled = false;
    let consecutivePass = 0;
    let consecutiveFail = 0;
    let currentlyPassed = false;
    const startedAt = performance.now();

    const emit = (passed: boolean) => {
      if (passed === currentlyPassed) return;
      currentlyPassed = passed;
      onStatusChange(passed);
    };

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
          await videoRef.current.play();
        }

        const resolver = await FilesetResolver.forVisionTasks(WASM_BASE);
        landmarker = await FaceLandmarker.createFromOptions(resolver, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
        });
        if (cancelled) return;

        setStatus("no-face");
        loop();
      } catch (err) {
        console.error("[sunglasses-gate] init failed", err);
        setStatus("error");
      }
    }

    function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !landmarker || video.readyState < 2) return;

      setElapsedMs(performance.now() - startedAt);

      const result = landmarker.detectForVideo(video, performance.now());
      if (!result.faceLandmarks?.length) {
        consecutivePass = 0;
        consecutiveFail++;
        if (!currentlyPassed) setStatus("no-face");
        else if (consecutiveFail >= FAIL_FRAMES * 2) {
          setStatus("no-face");
          emit(false);
        }
        // Hold the overlay steady through brief detection gaps
        const faceProbablyGone = consecutiveFail > 20;
        const target =
          (currentlyPassed || manualOverrideRef.current) && !faceProbablyGone
            ? 1
            : 0;
        glowRef.current += (target - glowRef.current) * 0.08;
        if (lastLandmarksRef.current && glowRef.current > 0.02) {
          drawOverlay(
            overlayRef.current,
            video.videoWidth,
            video.videoHeight,
            lastLandmarksRef.current,
            performance.now() - startedAt,
            glowRef.current,
          );
        } else {
          clearOverlay(overlayRef.current);
        }
        return;
      }

      const lm = result.faceLandmarks[0];
      lastLandmarksRef.current = lm;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const leftEyeB = sampleBrightness(ctx, canvas, lm, LEFT_EYE);
      const rightEyeB = sampleBrightness(ctx, canvas, lm, RIGHT_EYE);
      const eyesB = (leftEyeB + rightEyeB) / 2;
      const refB = sampleBrightness(ctx, canvas, lm, FACE_REF);

      setEyeB(eyesB);
      setFaceB(refB);

      const darkerThanFace = refB - eyesB > CONTRAST_THRESHOLD;
      const absoluteDark = eyesB < EYE_MAX_BRIGHTNESS;
      const detected = darkerThanFace && absoluteDark;

      if (detected) {
        consecutivePass++;
        consecutiveFail = 0;
        if (consecutivePass >= PASS_FRAMES) {
          setStatus("pass");
          emit(true);
        } else if (!currentlyPassed) {
          setStatus("face-no-glasses");
        }
      } else {
        consecutiveFail++;
        consecutivePass = 0;
        if (currentlyPassed && consecutiveFail >= FAIL_FRAMES) {
          setStatus("face-no-glasses");
          emit(false);
        } else if (!currentlyPassed) {
          setStatus("face-no-glasses");
        }
      }

      const target = currentlyPassed || manualOverrideRef.current ? 1 : 0;
      glowRef.current += (target - glowRef.current) * 0.12;
      drawOverlay(
        overlayRef.current,
        video.videoWidth,
        video.videoHeight,
        lm,
        performance.now() - startedAt,
        glowRef.current,
      );
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      landmarker?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onStatusChange]);

  const passed = status === "pass" || manuallyOverridden;

  useEffect(() => {
    manualOverrideRef.current = manuallyOverridden;
    if (manuallyOverridden) onStatusChange(true);
  }, [manuallyOverridden, onStatusChange]);

  const statusText: Record<Status, string> = {
    loading: "booting…",
    "requesting-camera": "allow camera access",
    "no-face": "show your face to the camera",
    "face-no-glasses": "put on your sunglasses",
    pass: "✓ sunglasses detected",
    error: "camera blocked — check browser permissions",
  };

  const canManualOverride =
    elapsedMs > MANUAL_OVERRIDE_AFTER_MS && !passed;

  return (
    <>
      <div className="fixed inset-0 z-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
          muted
          playsInline
        />
        <canvas
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
        />
        <canvas ref={canvasRef} className="hidden" />
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_15%,rgba(0,0,0,0.85)_85%)]" />
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${
            passed ? "opacity-100" : "opacity-0"
          }`}
          style={{
            boxShadow: "inset 0 0 160px rgba(255,77,240,0.45)",
          }}
        />
      </div>

      <div className="pointer-events-none fixed left-1/2 top-6 z-30 -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2 font-mono text-[10px] uppercase tracking-widest backdrop-blur">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              passed
                ? "bg-fuchsia-400 shadow-[0_0_8px_rgba(255,77,240,0.8)]"
                : status === "error"
                  ? "bg-red-400"
                  : "bg-zinc-400 animate-pulse"
            }`}
          />
          <span>{statusText[status]}</span>
          <span className="text-zinc-600">
            {eyeB.toFixed(0)}/{faceB.toFixed(0)}
          </span>
        </div>
      </div>

      {canManualOverride && (
        <button
          onClick={() => setManuallyOverridden(true)}
          className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 font-mono text-[10px] uppercase tracking-widest text-zinc-500 underline hover:text-zinc-300"
        >
          manual override · I&apos;m wearing them
        </button>
      )}
    </>
  );
}
