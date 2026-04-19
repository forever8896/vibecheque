"use client";

import { useEffect, useRef } from "react";
import { useSession } from "./SessionProvider";

// Reference dance video, synced to the match clock, shown full-bleed
// during active play. Muted — SyncedMusic owns the audio so we don't end
// up with two tracks. The player's skeleton is drawn by a separate
// PlayerSkeletonOverlay component layered on top of this.

export function ReferenceVideoStage({ videoUrl }: { videoUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { match, phase, secondsElapsed } = useSession();

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (phase !== "playing") {
      v.pause();
      try {
        v.currentTime = 0;
      } catch {
        // seek fails before metadata is loaded
      }
      return;
    }
    const drift = Math.abs(v.currentTime - secondsElapsed);
    if (drift > 0.3) {
      try {
        v.currentTime = secondsElapsed;
      } catch {
        // not ready yet
      }
    }
    if (v.paused) {
      v.play().catch(() => {
        // Muted autoplay should always succeed; fall silent if not.
      });
    }
  }, [phase, match?.id, secondsElapsed]);

  return (
    <video
      ref={videoRef}
      key={videoUrl}
      src={videoUrl}
      playsInline
      muted
      className="pointer-events-none absolute inset-0 z-[5] h-full w-full object-cover"
    />
  );
}
