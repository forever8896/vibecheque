// Loads a choreography JSON (produced by scripts/extract_choreo.py) and
// converts time-aligned pose landmarks into PoseTargets the scorer can
// grade against. Loops the reference if the match outlasts it.

import { BONES, type BoneVec, type PoseTarget } from "./poseLibrary";

export type ChoreoFrame = {
  t: number;
  lm: { x: number; y: number; v: number }[];
};

export type Choreo = {
  source: string;
  videoWidth: number;
  videoHeight: number;
  durationMs: number;
  frameCount: number;
  avgFps: number;
  frames: ChoreoFrame[];
};

let cached: Choreo | null = null;
let loading: Promise<Choreo | null> | null = null;

export async function loadChoreo(): Promise<Choreo | null> {
  if (cached) return cached;
  if (loading) return loading;
  loading = fetch("/choreo.json", { cache: "force-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<Choreo>) : null))
    .then((c) => {
      if (c && c.frames && c.frames.length > 0) {
        cached = c;
        console.log(
          "[choreo] loaded",
          c.frameCount,
          "frames over",
          c.durationMs,
          "ms",
        );
        return c;
      }
      console.warn("[choreo] /choreo.json missing or empty");
      return null;
    })
    .catch((e) => {
      console.warn("[choreo] fetch failed", e);
      return null;
    });
  return loading;
}

// Binary search the frame at or before tMs (wraps around on loop)
export function frameAt(choreo: Choreo, tMs: number): ChoreoFrame | null {
  const frames = choreo.frames;
  if (frames.length === 0) return null;
  const wrap = choreo.durationMs > 0 ? choreo.durationMs : frames[frames.length - 1].t + 1;
  const t = ((tMs % wrap) + wrap) % wrap;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}

// Convert a reference frame into bone unit vectors so the existing
// poseMatcher can score the player against it.
export function frameToTarget(frame: ChoreoFrame): PoseTarget {
  const vectors: BoneVec[] = BONES.map((bone) => {
    const a = frame.lm[bone.from];
    const b = frame.lm[bone.to];
    if (!a || !b) return [0, 0] as const;
    if (a.v < 0.25 || b.v < 0.25) return [0, 0] as const;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 0.001) return [0, 0] as const;
    return [dx / mag, dy / mag] as const;
  });
  return { name: "CHOREO", label: "FOLLOW THE DANCE", vectors };
}
