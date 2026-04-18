"use client";

import { useEffect, useRef, useState } from "react";
import type { Match, MatchPhase } from "./useMatch";

// Demo track committed at public/harnas-ice-tea.mp3.
// If autoplay is blocked, a "tap to enable audio" pill shows up.
const TRACK_SRC = "/harnas-ice-tea.mp3";

export function SyncedMusic({
  match,
  phase,
  secondsElapsed,
}: {
  match: Match | null;
  phase: MatchPhase;
  secondsElapsed: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (phase !== "playing") {
      audio.pause();
      audio.currentTime = 0;
      setNeedsGesture(false);
      return;
    }

    // Resync if drift exceeds 300ms
    const drift = Math.abs(audio.currentTime - secondsElapsed);
    if (drift > 0.3) {
      try {
        audio.currentTime = secondsElapsed;
      } catch {
        /* seek fails before audio is ready */
      }
    }
    if (audio.paused) {
      audio.play().catch(() => {
        setNeedsGesture(true);
      });
    }
    // depend on match.id so we re-enter the branch on new matches
  }, [phase, match?.id, secondsElapsed]);

  const enable = () => {
    audioRef.current?.play().then(
      () => setNeedsGesture(false),
      () => {
        /* still blocked */
      },
    );
  };

  return (
    <>
      <audio
        ref={audioRef}
        src={TRACK_SRC}
        preload="auto"
        onError={() => setMissing(true)}
      />
      {needsGesture && !missing && (
        <button
          onClick={enable}
          className="pointer-events-auto fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-fuchsia-500 px-5 py-2 text-xs font-semibold text-black shadow-[0_0_30px_rgba(255,77,240,0.5)]"
        >
          Tap to enable music
        </button>
      )}
      {missing && phase === "playing" && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-400 backdrop-blur">
          no audio · /public/harnas-ice-tea.mp3 missing
        </div>
      )}
    </>
  );
}
