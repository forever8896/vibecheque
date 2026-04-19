import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Start-gate check for the idle-lobby dab. We don't try to validate a
// full dab pose — that's brittle and demands players mimic the ghost
// 1:1. We just check that ONE hand reaches up-and-out past the
// shoulders, the distinctive "corner touch" of a dab. The other arm can
// do whatever.
//
// All coords are MediaPipe-native (non-mirrored): +x = camera-right =
// person's LEFT side; +y = down.

export type DabMirror = "left" | "right";

export type DabAssessment = {
  matched: boolean;
  mirror: DabMirror | null;
};

// Wrist must be this much above shoulder Y (normalized frame height).
const WRIST_ABOVE_SHOULDER = 0.1;
// Wrist must be off-center toward its own side by ≥ this × shoulder span.
const WRIST_OUT_RATIO = 1.0;

export function assessDab(lm: NormalizedLandmark[]): DabAssessment {
  const ls = lm[11];
  const rs = lm[12];
  const lw = lm[15];
  const rw = lm[16];
  if (!ls || !rs || !lw || !rw) return { matched: false, mirror: null };
  if ((ls.visibility ?? 0) < 0.4 || (rs.visibility ?? 0) < 0.4) {
    return { matched: false, mirror: null };
  }

  const shoulderY = (ls.y + rs.y) / 2;
  const centerX = (ls.x + rs.x) / 2;
  const shoulderSpan = Math.abs(ls.x - rs.x) || 0.15;
  const minOut = shoulderSpan * WRIST_OUT_RATIO;

  // Person's left hand (landmark 15, lives on camera +x) reaching up-out
  // past the left shoulder.
  if ((lw.visibility ?? 0) >= 0.3) {
    const up = shoulderY - lw.y;
    const out = lw.x - centerX;
    if (up > WRIST_ABOVE_SHOULDER && out > minOut) {
      return { matched: true, mirror: "left" };
    }
  }

  // Person's right hand (landmark 16, lives on camera -x) reaching up-out
  // past the right shoulder.
  if ((rw.visibility ?? 0) >= 0.3) {
    const up = shoulderY - rw.y;
    const out = centerX - rw.x;
    if (up > WRIST_ABOVE_SHOULDER && out > minOut) {
      return { matched: true, mirror: "right" };
    }
  }

  return { matched: false, mirror: null };
}
