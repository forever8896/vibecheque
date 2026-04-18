"use client";

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";
import { beatState } from "./beats";
import { POSE_LIBRARY, type PoseTarget } from "./poseLibrary";
import { poseSimilarity } from "./poseMatcher";

export type PoseFrame = {
  landmarks: NormalizedLandmark[];
  // Live score = similarity × 100, 0-100
  score: number;
  updatedAt: number;
  // Pose-matching telemetry
  target: PoseTarget | null;
  targetIdx: number; // index into POSE_LIBRARY
  similarity: number; // live similarity 0..1 against current target
  peakSimilarity: number; // best similarity so far this target window
  timeInWindow: number; // ms since target was set
  musicOn: boolean;
  bassIntensity: number;
  bpm: number;
  // Diagnostic carry-overs (kept for the match log)
  activity: number; // |avgVelocity| for debugging
};

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Beats between pose switches. 2 @ 120 BPM ≈ 1s per pose.
const BEATS_PER_POSE = 2;
// Fallback rotation when music isn't detected.
const FALLBACK_POSE_MS = 2200;

type PoseTargetProvider = (tsMs: number) => PoseTarget | null;

export function usePoseScore(
  track: MediaStreamTrack | null | undefined,
  opts?: {
    forcedTargetName?: string | null;
    // If set, overrides both forced + random rotation. Called each frame
    // with the perf-now timestamp; return null to fall through.
    getTarget?: PoseTargetProvider;
  },
): { score: number; frameRef: React.RefObject<PoseFrame | null> } {
  const [score, setScore] = useState(0);
  const frameRef = useRef<PoseFrame | null>(null);
  const forcedNameRef = useRef<string | null>(opts?.forcedTargetName ?? null);
  const getTargetRef = useRef<PoseTargetProvider | null>(
    opts?.getTarget ?? null,
  );
  useEffect(() => {
    forcedNameRef.current = opts?.forcedTargetName ?? null;
  }, [opts?.forcedTargetName]);
  useEffect(() => {
    getTargetRef.current = opts?.getTarget ?? null;
  }, [opts?.getTarget]);

  useEffect(() => {
    if (!track) return;

    let cancelled = false;
    let rafId = 0;
    let landmarker: PoseLandmarker | null = null;
    let prev: NormalizedLandmark[] | null = null;
    let lastSetAt = 0;
    let lastTs = 0;

    // Target rotation state
    let targetIdx = Math.floor(Math.random() * POSE_LIBRARY.length);
    let target = POSE_LIBRARY[targetIdx];
    let targetStartedAt = 0;
    let peakSim = 0;
    let lastBeatSeen = 0;
    let beatsCounted = 0;

    function rotateTarget(now: number) {
      // Pick a different pose than the current one
      let next = Math.floor(Math.random() * POSE_LIBRARY.length);
      if (POSE_LIBRARY.length > 1 && next === targetIdx) {
        next = (next + 1) % POSE_LIBRARY.length;
      }
      targetIdx = next;
      target = POSE_LIBRARY[next];
      targetStartedAt = now;
      peakSim = 0;
      beatsCounted = 0;
    }

    const video = document.createElement("video");
    video.srcObject = new MediaStream([track]);
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    async function init() {
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
        targetStartedAt = performance.now();
        loop();
      } catch (err) {
        console.error("[pose-score] init failed", err);
      }
    }

    function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      if (!landmarker || video.readyState < 2) return;

      const ts = performance.now();
      if (ts - lastTs < 33) return; // ~30 fps cap
      lastTs = ts;

      let result;
      try {
        result = landmarker.detectForVideo(video, ts);
      } catch {
        return;
      }
      if (!result.landmarks?.length) return;

      const cur = result.landmarks[0];

      // Light-weight activity reading for the debug log (not used for score)
      let activityRaw = 0;
      if (prev) {
        let sum = 0;
        let n = 0;
        for (let i = 11; i <= 32; i++) {
          const a = prev[i];
          const b = cur[i];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          sum += Math.sqrt(dx * dx + dy * dy);
          n++;
        }
        activityRaw = n > 0 ? sum / n : 0;
      }

      const musicOn = beatState.isActive;
      // Choreography override beats everything else — a time-aligned
      // reference frame trumps forced poses and random rotation.
      const overrideTarget = getTargetRef.current?.(ts) ?? null;
      if (overrideTarget) {
        target = overrideTarget;
        targetIdx = -1;
      } else {
        const forced = forcedNameRef.current;
        if (forced) {
          const forcedIdx = POSE_LIBRARY.findIndex((p) => p.name === forced);
          if (forcedIdx >= 0 && forcedIdx !== targetIdx) {
            targetIdx = forcedIdx;
            target = POSE_LIBRARY[forcedIdx];
            targetStartedAt = ts;
            peakSim = 0;
          }
        } else if (musicOn) {
          if (beatState.lastFlashAt > lastBeatSeen) {
            lastBeatSeen = beatState.lastFlashAt;
            beatsCounted++;
            if (beatsCounted >= BEATS_PER_POSE) {
              rotateTarget(ts);
            }
          }
        } else if (ts - targetStartedAt > FALLBACK_POSE_MS) {
          rotateTarget(ts);
        }
      }

      // Score against the current target
      const sim = poseSimilarity(cur, target);
      if (sim > peakSim) peakSim = sim;

      const liveScore = Math.max(0, Math.min(100, Math.round(sim * 100)));

      frameRef.current = {
        landmarks: cur,
        score: liveScore,
        updatedAt: ts,
        target,
        targetIdx,
        similarity: sim,
        peakSimilarity: peakSim,
        timeInWindow: ts - targetStartedAt,
        musicOn,
        bassIntensity: beatState.intensity,
        bpm: beatState.bpm,
        activity: activityRaw,
      };

      if (ts - lastSetAt > 100) {
        lastSetAt = ts;
        setScore(liveScore);
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
