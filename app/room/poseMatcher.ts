import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { BONES, type PoseTarget } from "./poseLibrary";

// Returns 0..1 where 1 is a perfect pose match.
// Per bone: cosine similarity with the target unit vector, clamped to [0,1],
// squared to reward close matches more than half-efforts. Averaged over
// bones we can see clearly.
export function poseSimilarity(
  landmarks: NormalizedLandmark[],
  target: PoseTarget,
): number {
  let total = 0;
  let count = 0;

  for (let i = 0; i < BONES.length; i++) {
    const bone = BONES[i];
    const targetVec = target.vectors[i];
    if (!targetVec) continue;
    // Zero-magnitude target vec = "don't care" (reference frame unreliable)
    const targetMag = Math.hypot(targetVec[0], targetVec[1]);
    if (targetMag < 0.001) continue;
    const a = landmarks[bone.from];
    const b = landmarks[bone.to];
    if (!a || !b) continue;
    if ((a.visibility ?? 1) < 0.3 || (b.visibility ?? 1) < 0.3) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 0.001) continue;
    const ux = dx / mag;
    const uy = dy / mag;
    const dot = ux * targetVec[0] + uy * targetVec[1];
    // Half-circle: aligned=1, perpendicular=0, opposite=0. Then square for
    // stricter grading (0.7 alignment → 0.49 score).
    const bone01 = Math.max(0, dot);
    total += bone01 * bone01;
    count++;
  }

  return count > 0 ? total / count : 0;
}
