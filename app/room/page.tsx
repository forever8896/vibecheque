"use client";

import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useMaybeParticipantContext,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { MatchHUD } from "./MatchHUD";
import { SessionProvider, useSession } from "./SessionProvider";
import { SyncedMusic } from "./SyncedMusic";

function ScoreOverlay() {
  const participant = useMaybeParticipantContext();
  const { scores } = useSession();
  const score = participant ? (scores.get(participant.identity) ?? 0) : 0;
  const isLocal = participant?.isLocal ?? false;

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-white backdrop-blur">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isLocal ? "bg-fuchsia-400" : "bg-white/70"
        }`}
      />
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 bg-fuchsia-400 shadow-[0_0_8px_rgba(255,77,240,0.8)] transition-[width] duration-300"
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="w-6 text-right tabular-nums">{score}</span>
    </div>
  );
}

function DanceTile() {
  return (
    <div className="relative h-full w-full">
      <ParticipantTile />
      <ScoreOverlay />
    </div>
  );
}

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
      <DanceTile />
    </GridLayout>
  );
}

function RoomInner() {
  const { match, phase, secondsElapsed } = useSession();
  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-center justify-between px-4 py-3 text-xs uppercase tracking-widest opacity-70">
        <span>VibeCheque · {process.env.NEXT_PUBLIC_ROOM_NAME}</span>
        <Link href="/" className="text-zinc-400 hover:text-white">
          leave
        </Link>
      </header>
      <div className="relative flex-1 overflow-hidden px-2 pb-2">
        <Stage />
        <MatchHUD />
      </div>
      <RoomAudioRenderer />
      <SyncedMusic match={match} phase={phase} secondsElapsed={secondsElapsed} />
    </div>
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

  // Keep `authenticated` referenced for linters, though routing already enforces it.
  void authenticated;

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
        <SessionProvider>
          <RoomInner />
        </SessionProvider>
      </LiveKitRoom>
    </main>
  );
}
