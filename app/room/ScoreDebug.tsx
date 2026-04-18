"use client";

import { useEffect, useRef } from "react";
import { useSession } from "./SessionProvider";

// Dev-only overlay that reflects the live scoring math. Reads directly
// from localFrameRef via rAF so it doesn't re-render the React tree.
export function ScoreDebug() {
  const { localFrameRef, phase } = useSession();
  const rowsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId = 0;
    let cancelled = false;

    function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      const el = rowsRef.current;
      if (!el) return;
      const f = localFrameRef.current;
      if (!f) {
        el.innerHTML =
          '<div class="text-zinc-600">no pose frame yet</div>';
        return;
      }

      const beatClr = f.inBeatWindow ? "text-emerald-300" : "text-zinc-500";
      const musicClr = f.musicOn ? "text-fuchsia-300" : "text-zinc-500";

      el.innerHTML = `
<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
  <span class="text-zinc-500">phase</span>
  <span>${phase}</span>

  <span class="text-zinc-500">score</span>
  <span class="text-white">${f.score}</span>

  <span class="text-zinc-500">raw activity</span>
  <span>${f.rawActivity.toFixed(1)}</span>

  <span class="text-zinc-500">active joints</span>
  <span>${f.activeJoints}/${f.totalJoints}</span>

  <span class="text-zinc-500">music</span>
  <span class="${musicClr}">${f.musicOn ? "on" : "no beats yet"}</span>

  <span class="text-zinc-500">bass</span>
  <span>${f.bassIntensity.toFixed(2)}</span>

  <span class="text-zinc-500">BPM</span>
  <span>${f.bpm || "—"}</span>

  <span class="text-zinc-500">beat window</span>
  <span class="${beatClr}">${f.inBeatWindow ? "IN" : "out"} (${(f.beatCloseness * 100).toFixed(0)}%)</span>
</div>`;
    }
    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [localFrameRef, phase]);

  return (
    <div
      ref={rowsRef}
      className="pointer-events-none fixed left-3 top-14 z-[80] rounded-xl border border-white/10 bg-black/80 px-3 py-2 font-mono text-[10px] leading-tight text-zinc-200 backdrop-blur"
    />
  );
}
