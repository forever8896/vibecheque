"use client";

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";

export type PoseFrame = {
  landmarks: NormalizedLandmark[];
  score: number;
  updatedAt: number;
};

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Body joints only (skip face 0-10 which are noisy and don't represent dance)
const JOINTS = Array.from({ length: 22 }, (_, i) => i + 11);
const EMA_ALPHA = 0.15;
const SCALE = 2500;

export function usePoseScore(
  track: MediaStreamTrack | null | undefined,
): { score: number; frameRef: React.RefObject<PoseFrame | null> } {
  const [score, setScore] = useState(0);
  const frameRef = useRef<PoseFrame | null>(null);

  useEffect(() => {
    if (!track) return;

    let cancelled = false;
    let rafId = 0;
    let landmarker: PoseLandmarker | null = null;
    let prev: NormalizedLandmark[] | null = null;
    let ema = 0;
    let lastSetAt = 0;
    let lastTs = 0;

    const video = document.createElement("video");
    video.srcObject = new MediaStream([track]);
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    async function init() {
      // Fire-and-forget play. AbortError is expected under React strict-mode
      // double-invocation when cleanup nulls srcObject before play resolves.
      video.play().catch((err: Error) => {
        if (err.name !== "AbortError") {
          console.warn("[pose-score] video.play failed", err);
        }
      });

      try {
        const resolver = await FilesetResolver.forVisionTasks(WASM_BASE);
        landmarker = await PoseLandmarker.createFromOptions(resolver, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        if (cancelled) return;
        loop();
      } catch (err) {
        console.error("[pose-score] init failed", err);
      }
    }

    function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      if (!landmarker || video.readyState < 2) return;

      // MediaPipe requires strictly increasing timestamps
      const ts = performance.now();
      if (ts <= lastTs) return;
      lastTs = ts;

      let result;
      try {
        result = landmarker.detectForVideo(video, ts);
      } catch {
        return;
      }
      if (!result.landmarks?.length) return;

      const cur = result.landmarks[0];
      if (prev) {
        let sum = 0;
        let n = 0;
        for (const i of JOINTS) {
          const a = prev[i];
          const b = cur[i];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          sum += Math.sqrt(dx * dx + dy * dy);
          n++;
        }
        const instant = n > 0 ? sum / n : 0;
        ema = ema * (1 - EMA_ALPHA) + instant * EMA_ALPHA;

        // Throttle state updates to ~10 Hz
        const s = Math.max(0, Math.min(100, Math.round(ema * SCALE)));
        frameRef.current = { landmarks: cur, score: s, updatedAt: ts };
        if (ts - lastSetAt > 100) {
          lastSetAt = ts;
          setScore(s);
        }
      } else {
        frameRef.current = { landmarks: cur, score: 0, updatedAt: ts };
      }
      prev = cur;
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      landmarker?.close();
      video.srcObject = null;
      frameRef.current = null;
    };
  }, [track]);

  return { score, frameRef };
}
