"use client";

import {
  LiveKitRoom,
  ParticipantContext,
  RoomAudioRenderer,
  TrackRefContext,
  useMaybeParticipantContext,
  useMaybeRoomContext,
  useParticipants,
} from "@livekit/components-react";
import {
  RoomEvent,
  Track,
  type TrackPublication,
} from "livekit-client";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-core";
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  BodyAura,
  FlowPill,
  ScoreCallouts,
  TileAmbient,
  tileVideoFilter,
} from "./BodyFX";
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

function AttachedVideo({
  publication,
  mirror,
}: {
  publication: TrackPublication | undefined;
  mirror: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const track = publication?.track;
    if (!video || !track) return;
    track.attach(video);
    return () => {
      track.detach(video);
    };
  }, [publication, publication?.track]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="h-full w-full object-cover"
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

function DanceTile() {
  const participant = useMaybeParticipantContext();
  const { scores, phase } = useSession();
  const identity = participant?.identity;
  const isLocal = participant?.isLocal ?? false;
  const score = identity ? (scores.get(identity) ?? 0) : 0;
  const active = phase === "playing" || phase === "countdown";

  const camPub = participant?.getTrackPublication(Track.Source.Camera);
  const hasVideo = !!camPub?.track;

  return (
    <div
      data-dance-tile={identity}
      className="relative h-full min-h-0 w-full overflow-hidden rounded-xl bg-zinc-900"
    >
      {hasVideo ? (
        <div
          className="absolute inset-0 transition-[filter] duration-300"
          style={{
            filter: active ? tileVideoFilter(score, isLocal) : "none",
          }}
        >
          <AttachedVideo publication={camPub} mirror={isLocal} />
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5 font-mono text-xl font-semibold text-zinc-300">
            {(participant?.name || identity || "?").slice(0, 2).toUpperCase()}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {isLocal ? "publishing camera…" : "waiting for camera…"}
          </p>
        </div>
      )}
      {isLocal && <BodyAura />}
      <TileAmbient identity={identity} />
      {isLocal && <ScoreCallouts />}
      <ScoreOverlay />
      <FlowPill identity={identity} />
    </div>
  );
}

function Stage() {
  const room = useMaybeRoomContext();
  const participants = useParticipants();
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!room) return;
    const events = [
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ];
    const handler = () => bump();
    for (const e of events) room.on(e, handler);
    return () => {
      for (const e of events) room.off(e, handler);
    };
  }, [room]);

  if (participants.length === 0) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-zinc-500">
        waiting for the room…
      </div>
    );
  }

  const n = participants.length;
  const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;

  return (
    <div
      className="grid h-full w-full gap-2"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: "minmax(0, 1fr)",
      }}
    >
      {participants.map((p) => {
        const pub = p.getTrackPublication(Track.Source.Camera);
        const trackRef: TrackReferenceOrPlaceholder = pub
          ? { participant: p, source: Track.Source.Camera, publication: pub }
          : { participant: p, source: Track.Source.Camera };
        return (
          <ParticipantContext.Provider key={p.identity} value={p}>
            <TrackRefContext.Provider value={trackRef}>
              <DanceTile />
            </TrackRefContext.Provider>
          </ParticipantContext.Provider>
        );
      })}
    </div>
  );
}

function RoomInner() {
  const { match, phase, secondsElapsed } = useSession();
  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      <header className="flex items-center justify-between px-4 py-3 text-xs uppercase tracking-widest opacity-70">
        <span>VibeCheque · {process.env.NEXT_PUBLIC_ROOM_NAME}</span>
        <Link href="/" className="text-zinc-400 hover:text-white">
          leave
        </Link>
      </header>
      <div className="relative flex-1 min-h-0 overflow-hidden px-2 pb-2">
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
