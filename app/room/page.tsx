"use client";

import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <GridLayout
      tracks={tracks}
      className="h-full w-full [--lk-grid-gap:0.5rem]"
    >
      <ParticipantTile />
    </GridLayout>
  );
}

export default function RoomPage() {
  const { user, ready, authenticated } = usePrivy();
  const [token, setToken] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const identity =
      user?.wallet?.address ??
      user?.id ??
      `guest-${Math.random().toString(36).slice(2, 10)}`;
    const name = user?.email?.address ?? identity.slice(0, 10);
    const room = process.env.NEXT_PUBLIC_ROOM_NAME ?? "vibecheque-main";

    const params = new URLSearchParams({ identity, name, room });
    fetch(`/api/livekit-token?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((data: { token: string; url: string }) => {
        setToken(data.token);
        setWsUrl(data.url);
      })
      .catch((e) => setError(String(e)));
  }, [ready, user]);

  if (!ready || (!token && !error)) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm opacity-60">
        Warming up the dance floor…
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="font-mono text-sm text-red-400">{error}</p>
        <Link href="/" className="text-xs underline opacity-60">
          back
        </Link>
      </main>
    );
  }

  if (!token || !wsUrl) return null;

  return (
    <main className="flex flex-1 flex-col">
      <LiveKitRoom
        token={token}
        serverUrl={wsUrl}
        connect
        video
        audio
        data-lk-theme="default"
        className="flex-1"
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between px-4 py-3 text-xs uppercase tracking-widest opacity-70">
            <span>VibeCheque · {process.env.NEXT_PUBLIC_ROOM_NAME}</span>
            <span>
              {authenticated ? user?.wallet?.address?.slice(0, 8) : "guest"}
            </span>
          </header>
          <div className="flex-1 overflow-hidden px-2 pb-2">
            <Stage />
          </div>
          <RoomAudioRenderer />
        </div>
      </LiveKitRoom>
    </main>
  );
}
