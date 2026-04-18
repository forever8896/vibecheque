"use client";

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";
import { beatState } from "./beats";

export type PoseFrame = {
  landmarks: NormalizedLandmark[];
  score: number;
  updatedAt: number;
  // Activity-only component (before rhythm weighting), 0-100
  activity: number;
  // Rhythm alignment 0-1 over a rolling window
  rhythm: number;
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

    // Rhythm tracking: increment on each new beat from beats.ts
    let lastBeatSeen = 0;
    let beatsHit = 0; // decaying "weighted count of beats caught"
    let beatsTotal = 0; // decaying total beats seen
    const RHYTHM_HALF_LIFE_MS = 4500; // ~4.5s memory
    const CATCH_THRESHOLD = 30; // activity score above which a beat counts as hit
    let rhythm = 1; // latest rhythm alignment 0-1

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

      // Cap at ~30fps to keep the main thread responsive
      const ts = performance.now();
      if (ts - lastTs < 33) return;
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

        const activity = Math.max(0, Math.min(100, Math.round(ema * SCALE)));

        // --- rhythm alignment ------------------------------------------------
        // Exponential decay of both "caught" and "total" counters so recent
        // beats matter most.
        const dt = ts - (frameRef.current?.updatedAt ?? ts);
        if (dt > 0) {
          const decay = Math.pow(0.5, dt / RHYTHM_HALF_LIFE_MS);
          beatsHit *= decay;
          beatsTotal *= decay;
        }
        // If a new beat was registered since we last looked, evaluate it
        const beatTs = beatState.lastFlashAt;
        if (beatTs > lastBeatSeen) {
          lastBeatSeen = beatTs;
          beatsTotal += 1;
          if (activity >= CATCH_THRESHOLD) beatsHit += 1;
        }
        if (beatState.isActive && beatsTotal > 0.05) {
          rhythm = Math.max(0, Math.min(1, beatsHit / beatsTotal));
        } else {
          // No beats yet → no rhythm penalty
          rhythm = 1;
        }

        // Weight: 40% activity floor + 60% weighted by rhythm alignment
        const s = Math.max(
          0,
          Math.min(100, Math.round(activity * (0.4 + 0.6 * rhythm))),
        );
        frameRef.current = {
          landmarks: cur,
          score: s,
          updatedAt: ts,
          activity,
          rhythm,
        };
        if (ts - lastSetAt > 100) {
          lastSetAt = ts;
          setScore(s);
        }
      } else {
        frameRef.current = {
          landmarks: cur,
          score: 0,
          updatedAt: ts,
          activity: 0,
          rhythm: 1,
        };
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
