"use client";

import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useLocalParticipant,
  useMaybeParticipantContext,
  useMaybeRoomContext,
  useTracks,
} from "@livekit/components-react";
import {
  LocalVideoTrack,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from "livekit-client";
import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePoseScore } from "./usePoseScore";

const ScoresContext = createContext<Map<string, number>>(new Map());

function useScoreFor(identity: string | undefined): number {
  const scores = useContext(ScoresContext);
  return identity ? (scores.get(identity) ?? 0) : 0;
}

function ScoresProvider({ children }: { children: React.ReactNode }) {
  const room = useMaybeRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [scores, setScores] = useState<Map<string, number>>(new Map());

  const [localTrack, setLocalTrack] = useState<MediaStreamTrack | null>(null);

  useEffect(() => {
    if (!localParticipant) return;
    const sync = () => {
      const pub = localParticipant.getTrackPublication(Track.Source.Camera);
      const t = pub?.track;
      setLocalTrack(
        t instanceof LocalVideoTrack ? (t.mediaStreamTrack ?? null) : null,
      );
    };
    sync();
    localParticipant.on("trackPublished", sync);
    localParticipant.on("trackUnpublished", sync);
    localParticipant.on("localTrackPublished", sync);
    return () => {
      localParticipant.off("trackPublished", sync);
      localParticipant.off("trackUnpublished", sync);
      localParticipant.off("localTrackPublished", sync);
    };
  }, [localParticipant]);

  const myScore = usePoseScore(localTrack);

  useEffect(() => {
    if (!localParticipant) return;
    setScores((prev) => {
      if (prev.get(localParticipant.identity) === myScore) return prev;
      const next = new Map(prev);
      next.set(localParticipant.identity, myScore);
      return next;
    });
  }, [localParticipant, myScore]);

  useEffect(() => {
    if (!localParticipant) return;
    const encoder = new TextEncoder();
    const id = setInterval(() => {
      const payload = encoder.encode(JSON.stringify({ score: myScore }));
      localParticipant.publishData(payload, { reliable: false });
    }, 500);
    return () => clearInterval(id);
  }, [localParticipant, myScore]);

  useEffect(() => {
    if (!room) return;
    const decoder = new TextDecoder();
    const onData = (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (!participant) return;
      try {
        const parsed = JSON.parse(decoder.decode(payload));
        if (typeof parsed.score === "number") {
          setScores((prev) => {
            const next = new Map(prev);
            next.set(participant.identity, parsed.score);
            return next;
          });
        }
      } catch {
        // malformed payload, ignore
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  return (
    <ScoresContext.Provider value={scores}>{children}</ScoresContext.Provider>
  );
}

function ScoreOverlay() {
  const participant = useMaybeParticipantContext();
  const score = useScoreFor(participant?.identity);
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
        <ScoresProvider>
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
        </ScoresProvider>
      </LiveKitRoom>
    </main>
  );
}
