import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Arm-point track selector. The player extends one arm out to that
// side — person's right for "next", person's left for "previous" — at
// roughly shoulder height, holds for HOLD_MS, and the change fires.
//
// Shape is a T-pose but with only ONE arm extended at a time. That
// separates it cleanly from the start-gesture dab (one arm diagonally
// up-and-out, wrist well ABOVE the shoulder) and from calibration
// (both arms out).
//
// All coords are MediaPipe-native: +x = camera-right = person's LEFT.

export type ArmDirection = "left" | "right"; // player's body frame

const HOLD_MS = 600;
const WRIST_OUT_MIN = 0.18; // wrist extends ≥ this fraction of frame width outward
const WRIST_V_MAX = 0.09;
const ELBOW_V_MAX = 0.11;
const JOINT_VIS_MIN = 0.4;

export class ArmPointDetector {
  private dir: ArmDirection | null = null;
  private since = 0;

  observe(lm: NormalizedLandmark[] | null, tsMs: number): void {
    const next = lm ? detectDirection(lm) : null;
    if (next !== this.dir) {
      this.dir = next;
      this.since = tsMs;
    }
  }

  // Current held direction + hold progress 0..1. Null if no arm is
  // extended cleanly.
  progress(tsMs: number): { dir: ArmDirection; value: number } | null {
    if (!this.dir) return null;
    return {
      dir: this.dir,
      value: Math.min(1, (tsMs - this.since) / HOLD_MS),
    };
  }

  // If the current hold has crossed the threshold, consume it and
  // return the direction (then reset so the next one requires releasing
  // and re-extending the arm).
  consume(tsMs: number): ArmDirection | null {
    if (!this.dir) return null;
    if (tsMs - this.since < HOLD_MS) return null;
    const fired = this.dir;
    this.dir = null;
    this.since = 0;
    return fired;
  }

  reset(): void {
    this.dir = null;
    this.since = 0;
  }
}

function detectDirection(lm: NormalizedLandmark[]): ArmDirection | null {
  const ls = lm[11];
  const rs = lm[12];
  if (!ls || !rs) return null;
  if (
    (ls.visibility ?? 0) < JOINT_VIS_MIN ||
    (rs.visibility ?? 0) < JOINT_VIS_MIN
  ) {
    return null;
  }
  const shoulderY = (ls.y + rs.y) / 2;

  const le = lm[13];
  const lw = lm[15];
  const re = lm[14];
  const rw = lm[16];

  // Person's-left arm points to camera +x (high x). Person's-right arm
  // points to camera -x (low x). sideSign multiplies the delta so we
  // measure "outward" regardless of which arm.
  const leftExt = !!(
    le &&
    lw &&
    armExtended(ls, le, lw, shoulderY, +1)
  );
  const rightExt = !!(
    re &&
    rw &&
    armExtended(rs, re, rw, shoulderY, -1)
  );

  if (leftExt && !rightExt) return "left";
  if (rightExt && !leftExt) return "right";
  return null;
}

function armExtended(
  shoulder: NormalizedLandmark,
  elbow: NormalizedLandmark,
  wrist: NormalizedLandmark,
  shoulderY: number,
  sideSign: number,
): boolean {
  if (
    (elbow.visibility ?? 0) < JOINT_VIS_MIN ||
    (wrist.visibility ?? 0) < JOINT_VIS_MIN
  ) {
    return false;
  }
  const wristDelta = (wrist.x - shoulder.x) * sideSign;
  const wristVertical = Math.abs(wrist.y - shoulderY);
  if (wristDelta < WRIST_OUT_MIN) return false;
  if (wristVertical > WRIST_V_MAX) return false;
  const elbowDelta = (elbow.x - shoulder.x) * sideSign;
  const elbowVertical = Math.abs(elbow.y - shoulderY);
  if (elbowDelta < WRIST_OUT_MIN * 0.35) return false;
  if (elbowDelta >= wristDelta) return false;
  if (elbowVertical > ELBOW_V_MAX) return false;
  return true;
}
