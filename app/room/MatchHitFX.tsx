"use client";

import { useEffect, useRef } from "react";
import { useSession } from "./SessionProvider";

// Visual feedback for "your body is hitting the reference dancer's shape."
// Reads frame.similarity (already computed by usePoseScore against the
// time-aligned choreo frame) and drives two effects on the local tile:
//
//   1. A continuous inset green glow whose intensity tracks sim linearly
//      above a soft floor — so every approach feels alive.
//
//   2. A punchy "hit flash" when sim crosses HIT_THRESHOLD, decaying over
//      ~400 ms. Rising-edge triggered with hysteresis so it only fires
//      when you actually land the pose, not while holding it.
//
// Pure rAF driven — no React state so 60 Hz updates don't churn the tree.

const SOFT_FLOOR = 0.3;   // no glow below this sim
const HIT_THRESHOLD = 0.55;
const RELEASE_THRESHOLD = 0.35; // must drop below this before another hit fires
const HIT_DECAY_MS = 400;

export function MatchHitFX() {
  const ringRef = useRef<HTMLDivElement>(null);
  const { localFrameRef, phase } = useSession();

  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let cancelled = false;
    let armed = true; // ready to fire a hit
    let lastHitAt = -Infinity;

    function loop() {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      const ring = ringRef.current;
      if (!ring) return;

      const f = localFrameRef.current;
      const sim = Math.max(0, Math.min(1, f?.similarity ?? 0));
      const now = performance.now();

      // Rising-edge: once we cross up through HIT_THRESHOLD, fire a
      // hit and disarm until sim drops back below RELEASE_THRESHOLD.
      if (armed && sim >= HIT_THRESHOLD) {
        lastHitAt = now;
        armed = false;
      } else if (!armed && sim < RELEASE_THRESHOLD) {
        armed = true;
      }

      const sincePeak = now - lastHitAt;
      const hitPulse = Math.max(0, 1 - sincePeak / HIT_DECAY_MS);

      const floorLinear = Math.max(0, (sim - SOFT_FLOOR) / (1 - SOFT_FLOOR));
      // Combine: whichever is stronger drives the glow.
      const glow = Math.min(1, floorLinear * 0.9 + hitPulse * 1.1);

      if (glow < 0.01) {
        ring.style.opacity = "0";
      } else {
        const innerPx = Math.round(40 + glow * 160);
        const ringAlpha = 0.15 + glow * 0.55;
        const outerAlpha = 0.1 + hitPulse * 0.45;
        ring.style.opacity = "1";
        ring.style.boxShadow = [
          `inset 0 0 ${innerPx}px rgba(74, 222, 128, ${ringAlpha.toFixed(3)})`,
          `0 0 ${Math.round(20 + hitPulse * 40)}px rgba(74, 222, 128, ${outerAlpha.toFixed(3)})`,
        ].join(", ");
      }
    }
    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [localFrameRef, phase]);

  return (
    <div
      ref={ringRef}
      className="pointer-events-none absolute inset-0 z-[7] rounded-[inherit] transition-opacity duration-200"
      style={{ opacity: 0 }}
    />
  );
}
