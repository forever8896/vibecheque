import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Direct landmark assessment for the "strike a dab" gate. The scorer's
// bone-vector cosine similarity is too fuzzy for a distinctive asymmetric
// pose, so we check concrete joint relationships instead.
//
// A dab has:
//   • one arm extended diagonally up-and-outward (elbow roughly straight)
//   • the OTHER arm bent ~90° with the elbow tucked toward the extended
//     side and the hand up near the face
// We accept either mirror. All coords are MediaPipe-native (non-mirrored):
// +x = camera-right = person's LEFT side; +y = down.

export type DabMirror = "left" | "right";

export type DabAssessment = {
  matched: boolean;
  mirror: DabMirror | null;
};

// Extended arm: wrist must be this much above shoulder (normalized frame y).
const EXT_WRIST_ABOVE = 0.07;
// Extended arm: wrist off-center by ≥ this × shoulder span toward its side.
const EXT_WRIST_OFF_RATIO = 1.0;
// Extended arm: shoulder→elbow and elbow→wrist must have cosine ≥ this.
const EXT_STRAIGHT_COS = 0.6;
// Bent arm: shoulder→elbow and elbow→wrist cosine must be ≤ this (bent).
// A straight arm scores ~1.0; a 90° dab elbow scores near 0; 0.7 catches
// anything more bent than a gentle lean without false-accepting "both
// arms raised to one side" (which scores ~0.98).
const BENT_COS_MAX = 0.7;
// Bent arm wrist must not be extended out on its own side past this many
// shoulder spans (positive ext-side, negative = bent-side). I.e. allow the
// hand anywhere from across-the-body to slightly on its own side, but
// reject a "two arms out to different sides" pose.
const BENT_WRIST_MAX_OFF_OPPOSITE = 0.35;
// Bent arm wrist shouldn't be below shoulder by much — a dab tucks it up.
const BENT_WRIST_BELOW_SHOULDER_MAX = 0.06;

function cosOfJoints(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark,
): number | null {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-5 || m2 < 1e-5) return null;
  return (v1x * v2x + v1y * v2y) / (m1 * m2);
}

export function assessDab(lm: NormalizedLandmark[]): DabAssessment {
  const ls = lm[11];
  const rs = lm[12];
  const le = lm[13];
  const re = lm[14];
  const lw = lm[15];
  const rw = lm[16];
  if (!ls || !rs || !le || !re || !lw || !rw) {
    return { matched: false, mirror: null };
  }
  if ((ls.visibility ?? 0) < 0.4 || (rs.visibility ?? 0) < 0.4) {
    return { matched: false, mirror: null };
  }
  if ((le.visibility ?? 0) < 0.3 || (re.visibility ?? 0) < 0.3) {
    return { matched: false, mirror: null };
  }
  if ((lw.visibility ?? 0) < 0.3 || (rw.visibility ?? 0) < 0.3) {
    return { matched: false, mirror: null };
  }

  const shoulderY = (ls.y + rs.y) / 2;
  const centerX = (ls.x + rs.x) / 2;
  const shoulderSpan = Math.abs(ls.x - rs.x) || 0.15;

  // Mirror "left" = person's left arm extended (landmarks 11/13/15, +x side).
  // Mirror "right" = person's right arm extended (landmarks 12/14/16, -x side).
  const mirrors: DabMirror[] = ["left", "right"];
  for (const mirror of mirrors) {
    const extSign = mirror === "left" ? 1 : -1;
    const es = mirror === "left" ? ls : rs;
    const ee = mirror === "left" ? le : re;
    const ew = mirror === "left" ? lw : rw;
    const bs = mirror === "left" ? rs : ls;
    const be = mirror === "left" ? re : le;
    const bw = mirror === "left" ? rw : lw;

    // 1. Extended wrist is clearly above shoulder.
    if (ew.y > shoulderY - EXT_WRIST_ABOVE) continue;

    // 2. Extended wrist is far off-center toward the extended side.
    const ewOff = (ew.x - centerX) * extSign;
    if (ewOff < shoulderSpan * EXT_WRIST_OFF_RATIO) continue;

    // 3. Arm points outward: wrist further from center than elbow.
    const eeOff = (ee.x - centerX) * extSign;
    if (ewOff <= eeOff) continue;

    // 4. Extended arm is roughly straight at the elbow.
    const extCos = cosOfJoints(es, ee, ew);
    if (extCos == null || extCos < EXT_STRAIGHT_COS) continue;

    // 5. Bent wrist is not extended out to the opposite (bent) side.
    //    In the extSign frame, bent side is the negative direction.
    const bwOff = (bw.x - centerX) * extSign;
    if (bwOff < -shoulderSpan * BENT_WRIST_MAX_OFF_OPPOSITE) continue;

    // 6. Bent arm is actually bent (elbow angle not straight).
    const bentCos = cosOfJoints(bs, be, bw);
    if (bentCos == null || bentCos > BENT_COS_MAX) continue;

    // 7. Bent wrist is tucked up near the face, not hanging at the side.
    if (bw.y > shoulderY + BENT_WRIST_BELOW_SHOULDER_MAX) continue;

    return { matched: true, mirror };
  }

  return { matched: false, mirror: null };
}
