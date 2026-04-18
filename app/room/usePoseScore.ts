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
  // Final score (0-100) — what peers see
  score: number;
  updatedAt: number;
  // Debug-oriented breakdown
  activeJoints: number; // count of joints with velocity > noise floor this frame
  totalJoints: number; // total joints we sampled
  rawActivity: number; // EMA of active joint velocities, 0..100-ish
  beatCloseness: number; // 0..1, 1 if exactly on beat, 0 if far from beat
  inBeatWindow: boolean; // whether this frame is within the beat window
  musicOn: boolean; // whether we've detected at least one beat
  bassIntensity: number; // live bass energy 0..1
  bpm: number; // smoothed BPM
};

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Body joints only (skip face 0-10 which are noisy and don't represent dance)
const JOINTS = Array.from({ length: 22 }, (_, i) => i + 11);

// Noise floor — per-joint velocity below this is treated as camera jitter,
// not real motion. Normalized coords; ~0.004 ≈ 2.5 pixels on a 640px frame.
const PER_JOINT_NOISE_FLOOR = 0.0045;

// How much to scale raw per-frame velocity into a 0-100 activity number
const ACTIVITY_SCALE = 1800;

// Time window around a beat where motion counts. Wider = more forgiving.
const BEAT_WINDOW_MS = 220;

// When music is playing, off-beat motion scores this fraction of on-beat
// (set to 0 for strict mode, 0.15 for softer gating)
const OFF_BEAT_FLOOR = 0.1;

// EMA smoothing factor for activity (0..1). Higher = twitchier.
const ACTIVITY_EMA = 0.25;

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
    let emaActivity = 0;
    let lastSetAt = 0;
    let lastTs = 0;

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

      // Per-joint velocity with a noise floor — only joints that actually
      // moved counted. Static body = 0 active joints = 0 activity.
      let activeJoints = 0;
      let totalActiveVel = 0;
      if (prev) {
        for (const i of JOINTS) {
          const a = prev[i];
          const b = cur[i];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const v = Math.sqrt(dx * dx + dy * dy);
          if (v > PER_JOINT_NOISE_FLOOR) {
            activeJoints++;
            totalActiveVel += v;
          }
        }
      }

      const avgActiveVel = activeJoints > 0 ? totalActiveVel / activeJoints : 0;
      // Boost by fraction of body active so full-body movement beats single-limb flails
      const jointFraction = activeJoints / JOINTS.length;
      const instant = avgActiveVel * (0.4 + 0.6 * jointFraction);
      emaActivity =
        emaActivity * (1 - ACTIVITY_EMA) + instant * ACTIVITY_EMA;
      const rawActivity = Math.max(0, Math.min(100, emaActivity * ACTIVITY_SCALE));

      // Beat-window gate
      const musicOn = beatState.isActive;
      const lastBeat = beatState.lastFlashAt;
      let beatCloseness = 0;
      let inBeatWindow = false;
      if (lastBeat > 0) {
        const timeSince = ts - lastBeat;
        if (timeSince <= BEAT_WINDOW_MS) {
          inBeatWindow = true;
          beatCloseness = 1 - timeSince / BEAT_WINDOW_MS;
        }
      }

      // Final score: strict gate when music is playing, pure activity otherwise
      let finalRaw: number;
      if (musicOn) {
        finalRaw = rawActivity * (OFF_BEAT_FLOOR + (1 - OFF_BEAT_FLOOR) * beatCloseness);
      } else {
        finalRaw = rawActivity;
      }
      const s = Math.max(0, Math.min(100, Math.round(finalRaw)));

      frameRef.current = {
        landmarks: cur,
        score: s,
        updatedAt: ts,
        activeJoints,
        totalJoints: JOINTS.length,
        rawActivity,
        beatCloseness,
        inBeatWindow,
        musicOn,
        bassIntensity: beatState.intensity,
        bpm: beatState.bpm,
      };

      if (ts - lastSetAt > 100) {
        lastSetAt = ts;
        setScore(s);
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
