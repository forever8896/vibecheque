"use client";

import { useEffect, useRef } from "react";
import { beatState } from "./beats";

// Full-viewport inset pulse that flashes fuchsia on each detected beat
// and softly breathes with the bass intensity. Pure rAF driven — doesn't
// touch React state so the beat doesn't cause tree re-renders.
export function BeatPulse() {
  const ringRef = useRef<HTMLDivElement>(null);
  const bpmRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId = 0;
    let cancelled = false;

    function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      const ring = ringRef.current;
      if (!ring) return;

      const now = performance.now();
      const timeSince = now - beatState.lastFlashAt;
      // Flash decays over 220ms
      const flash = Math.max(0, 1 - timeSince / 220);
      const bass = beatState.intensity;
      const punch = Math.min(1, flash * 0.9 + bass * 0.4);

      const size = 80 + punch * 260;
      const alpha = 0.12 + punch * 0.55;
      ring.style.boxShadow = `inset 0 0 ${size.toFixed(0)}px rgba(255, 77, 240, ${alpha.toFixed(3)})`;
      ring.style.opacity = beatState.isActive ? "1" : "0";

      const bpm = bpmRef.current;
      if (bpm && beatState.isActive) {
        bpm.textContent = beatState.bpm ? `${beatState.bpm} BPM` : "";
      }
    }
    loop();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <>
      <div
        ref={ringRef}
        className="pointer-events-none fixed inset-0 z-[45] transition-opacity duration-300"
      />
      <span
        ref={bpmRef}
        className="pointer-events-none fixed right-3 top-3 z-[46] font-mono text-[10px] uppercase tracking-widest text-fuchsia-300/80"
      />
    </>
  );
}
