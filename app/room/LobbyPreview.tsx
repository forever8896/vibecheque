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
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const src = videoUrl;

  // Start muted (autoplay is reliable with muted+playsInline across
  // every browser we care about), then try unmuting as soon as we can.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {
      // Even muted autoplay failed — unusual, the user will still see
      // the first frame and can click the tap-to-hear button.
    });
    const tryUnmute = () => {
      if (!v) return;
      v.muted = false;
      v.play()
        .then(() => setMuted(false))
        .catch(() => {
          v.muted = true;
        });
    };
    tryUnmute();
  }, []);

  if (failed) return null;

  const enable = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.play()
      .then(() => setMuted(false))
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
        muted
        playsInline
        preload="auto"
        className="pointer-events-none absolute inset-0 z-[5] h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
      {muted && (
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
