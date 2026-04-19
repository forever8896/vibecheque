"use client";

import { useEffect, useRef, useState } from "react";

// Full-opaque video overlay that plays the selected track's reference
// dance on the local player's tile during idle-lobby. Plays the video's
// own audio so the lobby has the song running alongside the reference
// movement. Sibling of the mirror-wrapper in DanceTile so the reference
// dance is shown un-flipped (unlike the webcam, which is mirrored).

export function LobbyPreview({ videoUrl }: { videoUrl: string }) {
  // Parent keys this component by videoUrl, so state resets on swap.
  const videoRef = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = videoUrl;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.play().catch(() => {
      // Autoplay blocked with audio — fall back to muted and prompt.
      v.muted = true;
      setBlocked(true);
      v.play().catch(() => {});
    });
  }, []);

  if (failed) return null;

  const enable = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.play()
      .then(() => setBlocked(false))
      .catch(() => {});
  };

  return (
    <>
      <video
        ref={videoRef}
        key={src}
        src={src}
        autoPlay
        loop
        playsInline
        className="pointer-events-none absolute inset-0 z-[5] h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
      {blocked && (
        <button
          onClick={enable}
          className="pointer-events-auto absolute bottom-3 right-3 z-10 rounded-full bg-fuchsia-500 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-black shadow-[0_0_20px_rgba(255,77,240,0.5)]"
        >
          tap to hear
        </button>
      )}
    </>
  );
}
