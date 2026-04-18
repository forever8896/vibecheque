"use client";

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";

type Status =
  | "loading"
  | "requesting-camera"
  | "no-body"
  | "center-yourself"
  | "step-closer"
  | "step-back"
  | "hold-still"
  | "ready"
  | "error";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Heuristics — all in normalized camera coords
const MIN_TORSO_HEIGHT = 0.16; // too close if smaller
const MAX_TORSO_HEIGHT = 0.5; // too far if bigger
const CENTER_TOLERANCE = 0.18; // shoulders midpoint x within 0.5 ± 0.18
const HOLD_FRAMES = 30; // ~1s at 30fps

export function CalibrationGate({ onReady }: { onReady: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
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
      if (!lm) {
        setStatus("no-body");
        holdCount = 0;
        setHoldProgress(0);
        return;
      }

      const ls = lm[11];
      const rs = lm[12];
      const lh = lm[23];
      const rh = lm[24];
      const shouldersVisible =
        (ls?.visibility ?? 0) > 0.55 && (rs?.visibility ?? 0) > 0.55;
      const hipsVisible =
        (lh?.visibility ?? 0) > 0.45 && (rh?.visibility ?? 0) > 0.45;

      if (!shouldersVisible) {
        setStatus("no-body");
        holdCount = 0;
        setHoldProgress(0);
        return;
      }

      const midX = (ls!.x + rs!.x) / 2;
      if (Math.abs(midX - 0.5) > CENTER_TOLERANCE) {
        setStatus("center-yourself");
        holdCount = 0;
        setHoldProgress(0);
        return;
      }

      if (!hipsVisible) {
        // Likely too close — hips usually cut off when user is right next to camera
        setStatus("step-back");
        holdCount = 0;
        setHoldProgress(0);
        return;
      }

      const midShoulderY = (ls!.y + rs!.y) / 2;
      const midHipY = (lh!.y + rh!.y) / 2;
      const torsoH = Math.abs(midHipY - midShoulderY);

      if (torsoH < MIN_TORSO_HEIGHT) {
        setStatus("step-closer");
        holdCount = 0;
        setHoldProgress(0);
        return;
      }
      if (torsoH > MAX_TORSO_HEIGHT) {
        setStatus("step-back");
        holdCount = 0;
        setHoldProgress(0);
        return;
      }

      holdCount++;
      setHoldProgress(Math.min(1, holdCount / HOLD_FRAMES));
      setStatus(holdCount >= HOLD_FRAMES ? "ready" : "hold-still");

      if (holdCount >= HOLD_FRAMES && !firedRef.current) {
        firedRef.current = true;
        setStatus("ready");
        onReady();
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
    "hold-still": "Hold still…",
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

      {/* Silhouette outline hint: centered human-proportion rectangle */}
      <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
        <div className="h-[72%] w-[32%] max-w-xs rounded-[160px] border-2 border-dashed border-white/25" />
      </div>

      <div className="pointer-events-none fixed inset-x-0 top-10 z-30 flex flex-col items-center gap-3 px-4 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300/80">
          step 1 · calibration
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
      </div>

      {/* Hold progress ring at bottom */}
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
