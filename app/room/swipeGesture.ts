import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Horizontal wrist-swipe detector. Either hand works; we track both and
// pick whichever produced a cleaner sweep. All coords are MediaPipe-native
// (non-mirrored): +x = camera-right = person's LEFT side.
//
// Returned direction is in the player's body frame, so "right" always
// means "the player swept toward their own right hand side" — regardless
// of which arm drew the motion. Callers can map that to next/prev.

export type SwipeDirection = "left" | "right";

export type SwipeSample = {
  tsMs: number;
  lwX: number | null;
  rwX: number | null;
  shoulderY: number | null;
  hipY: number | null;
  shoulderSpan: number;
};

// How far back to look when measuring displacement (ms).
const WINDOW_MS = 380;
// Displacement must exceed this × shoulder span within the window.
const MIN_DISPLACEMENT = 1.4;
// Reject swipes where the wrist dipped below hip or was below shoulder
// for the whole window — we want the hand up in the reading zone.
const MIN_UP_FRACTION = 0.6;
// Reject multi-direction motion: if the wrist reversed substantially
// inside the window, it's not a clean swipe.
const MAX_REVERSAL_RATIO = 0.3;

export class SwipeDetector {
  private samples: SwipeSample[] = [];

  observe(lm: NormalizedLandmark[] | null, tsMs: number): void {
    if (!lm) {
      this.samples.push({
        tsMs,
        lwX: null,
        rwX: null,
        shoulderY: null,
        hipY: null,
        shoulderSpan: 0,
      });
      this.trim(tsMs);
      return;
    }
    const ls = lm[11];
    const rs = lm[12];
    const lh = lm[23];
    const rh = lm[24];
    const lw = lm[15];
    const rw = lm[16];
    const shouldersOk =
      !!ls && !!rs && (ls.visibility ?? 0) > 0.4 && (rs.visibility ?? 0) > 0.4;
    const shoulderY = shouldersOk ? (ls!.y + rs!.y) / 2 : null;
    const shoulderSpan = shouldersOk ? Math.abs(ls!.x - rs!.x) : 0;
    const hipY =
      lh && rh && (lh.visibility ?? 0) > 0.3 && (rh.visibility ?? 0) > 0.3
        ? (lh.y + rh.y) / 2
        : null;
    const lwX = lw && (lw.visibility ?? 0) > 0.4 ? lw.x : null;
    const rwX = rw && (rw.visibility ?? 0) > 0.4 ? rw.x : null;
    const lwY = lw && (lw.visibility ?? 0) > 0.4 ? lw.y : null;
    const rwY = rw && (rw.visibility ?? 0) > 0.4 ? rw.y : null;

    this.samples.push({
      tsMs,
      // Only count wrist-x when the hand is in the "reading zone" between
      // shoulders (top) and hips (bottom). Dropping-hand motion doesn't
      // count as a swipe.
      lwX: isUp(lwY, shoulderY, hipY) ? lwX : null,
      rwX: isUp(rwY, shoulderY, hipY) ? rwX : null,
      shoulderY,
      hipY,
      shoulderSpan,
    });
    this.trim(tsMs);
  }

  // Check whether the buffered history forms a clean horizontal swipe in
  // either wrist. Returns the direction (in the player's body frame) and
  // clears history on a hit so callers don't fire repeatedly.
  detect(): SwipeDirection | null {
    const span = this.medianSpan();
    if (span <= 0) return null;
    const threshold = span * MIN_DISPLACEMENT;

    for (const key of ["lwX", "rwX"] as const) {
      const trail = this.trailFor(key);
      if (!trail) continue;
      const { first, last, min, max, upFrac } = trail;
      if (upFrac < MIN_UP_FRACTION) continue;

      const displacement = last - first;
      const absDisp = Math.abs(displacement);
      if (absDisp < threshold) continue;

      // Range (peak-to-trough) vs net displacement reveals how much the
      // motion reversed inside the window. A clean swipe has range ≈
      // |displacement|; a jitter has range ≫ |displacement|.
      const range = max - min;
      const reversal = range - absDisp;
      if (reversal > absDisp * MAX_REVERSAL_RATIO) continue;

      // +x in landmark space = camera-right = player's left side. So a
      // rightward motion in landmark space is a leftward motion in the
      // player's body frame.
      const dir: SwipeDirection = displacement > 0 ? "left" : "right";
      this.samples = [];
      return dir;
    }
    return null;
  }

  reset(): void {
    this.samples = [];
  }

  private trim(now: number) {
    const cutoff = now - WINDOW_MS;
    let i = 0;
    while (i < this.samples.length && this.samples[i].tsMs < cutoff) i++;
    if (i > 0) this.samples.splice(0, i);
  }

  private medianSpan(): number {
    const vals = this.samples
      .map((s) => s.shoulderSpan)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (vals.length === 0) return 0;
    return vals[Math.floor(vals.length / 2)];
  }

  private trailFor(key: "lwX" | "rwX") {
    const xs: number[] = [];
    let up = 0;
    let total = 0;
    for (const s of this.samples) {
      const v = s[key];
      if (v == null) {
        // Gap in tracking breaks the sweep — require continuous presence.
        return null;
      }
      xs.push(v);
      up++;
      total++;
    }
    if (xs.length < 4) return null;
    const first = xs[0];
    const last = xs[xs.length - 1];
    let min = xs[0];
    let max = xs[0];
    for (const x of xs) {
      if (x < min) min = x;
      if (x > max) max = x;
    }
    return { first, last, min, max, upFrac: up / Math.max(1, total) };
  }
}

function isUp(
  wristY: number | null,
  shoulderY: number | null,
  hipY: number | null,
): boolean {
  if (wristY == null || shoulderY == null) return false;
  // Swipe zone = chest-to-hip band. Excluding above-shoulder keeps dab
  // transitions (hand rising to a corner) from registering as a swipe.
  // Excluding below-hip keeps arms-at-sides from producing false swipes
  // when the player just turns.
  const top = shoulderY - 0.02;
  const bottom = hipY ?? shoulderY + 0.28;
  return wristY > top && wristY < bottom;
}
