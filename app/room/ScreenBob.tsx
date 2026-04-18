"use client";

import { useEffect, useRef } from "react";
import { beatState } from "./beats";

// Wraps its children in a div whose transform is driven by the beat:
// a subtle scale pulse on each detected beat + a continuous bass-energy
// breath between beats. Applied via rAF → zero React re-renders.
export function ScreenBob({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId = 0;
    let cancelled = false;

    function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      const el = ref.current;
      if (!el) return;
      const now = performance.now();
      const since = now - beatState.lastFlashAt;
      const flash = Math.max(0, 1 - since / 180); // decays 180ms
      const bass = beatState.intensity;
      // Scale: 1.0 at rest, up to ~1.025 on peak beats.
      const scale = 1 + flash * 0.022 + bass * 0.008;
      // Tiny bob downward on peak so it feels like gravity dropped.
      const ty = flash * 4 + bass * 2;
      el.style.transform = `scale(${scale.toFixed(4)}) translateY(${ty.toFixed(2)}px)`;
      el.style.transformOrigin = "center center";
    }
    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-0 will-change-transform"
      style={{ transition: "none" }}
    >
      {children}
    </div>
  );
}
