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
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  BodyAura,
  FlowPill,
  PlayerTint,
  tileVideoFilter,
} from "./BodyFX";
import { BeatPulse } from "./BeatPulse";
import { LobbyPreview } from "./LobbyPreview";
import { ReferenceVideoStage } from "./ReferenceVideoStage";
import { MatchHUD } from "./MatchHUD";
import { SessionProvider, useSession } from "./SessionProvider";
import { SyncedMusic } from "./SyncedMusic";
import { useLobby } from "./useLobby";
import type { PoseFrame } from "./usePoseScore";

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
  className,
  style,
  onVideo,
}: {
  publication: TrackPublication | undefined;
  className?: string;
  style?: React.CSSProperties;
  onVideo?: (video: HTMLVideoElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const track = publication?.track;
    if (!video || !track) return;
    track.attach(video);
    onVideo?.(video);
    return () => {
      track.detach(video);
      onVideo?.(null);
    };
  }, [publication, publication?.track, onVideo]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={
        className ?? "absolute inset-0 h-full w-full object-cover"
      }
      style={style}
    />
  );
}

// Drives a shared CSS transform (mirror + pan/zoom to follow the dancer)
// and applies it to any refs registered via addTarget.
function useLocalCameraTracking(
  localFrameRef: React.RefObject<PoseFrame | null> | null,
  mirror: boolean,
  active: boolean,
) {
  const targetsRef = useRef<Set<HTMLElement>>(new Set());
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let smoothCx = 0.5;
    let smoothCy = 0.5;
    let smoothZoom = 1;

    const MAX_PAN = 0.15; // fraction of tile
    const BASE_ZOOM = 1.2;
    const MIRROR_X = mirror ? -1 : 1;

    function loop() {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);

      let targetCx = 0.5;
      let targetCy = 0.5;
      let targetZoom = 1;

      if (active) {
        const frame = localFrameRef?.current;
        if (frame) {
          const lm = frame.landmarks;
          const visible = [lm[11], lm[12], lm[23], lm[24]].filter(
            (p) => p && (p.visibility ?? 1) > 0.45,
          );
          // Only pan when we have enough confident torso points
          if (visible.length >= 3) {
            targetCx =
              visible.reduce((s, p) => s + p.x, 0) / visible.length;
            targetCy =
              visible.reduce((s, p) => s + p.y, 0) / visible.length;
            targetZoom = BASE_ZOOM;
          } else if (
            lm[11] &&
            lm[12] &&
            (lm[11].visibility ?? 1) > 0.45 &&
            (lm[12].visibility ?? 1) > 0.45
          ) {
            // Shoulders only — bias down a bit so the camera doesn't latch
            // onto the face when hips are out of frame
            targetCx = (lm[11].x + lm[12].x) / 2;
            targetCy = (lm[11].y + lm[12].y) / 2 + 0.08;
            targetZoom = BASE_ZOOM;
          }
        }
      }

      smoothCx = smoothCx * 0.92 + targetCx * 0.08;
      smoothCy = smoothCy * 0.92 + targetCy * 0.08;
      smoothZoom = smoothZoom * 0.92 + targetZoom * 0.08;

      const dx = clamp(0.5 - smoothCx, -MAX_PAN, MAX_PAN);
      const dy = clamp(0.5 - smoothCy, -MAX_PAN, MAX_PAN);

      const transform = `scaleX(${MIRROR_X}) translate(${dx * 100}%, ${dy * 100}%) scale(${smoothZoom})`;
      for (const el of targetsRef.current) {
        el.style.transform = transform;
        el.style.transformOrigin = "center center";
      }
    }

    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [localFrameRef, mirror, active]);

  return {
    register: (el: HTMLElement | null) => {
      if (!el) return;
      targetsRef.current.add(el);
    },
    unregister: (el: HTMLElement | null) => {
      if (!el) return;
      targetsRef.current.delete(el);
    },
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function DanceTile() {
  const participant = useMaybeParticipantContext();
  const { scores, phase, localFrameRef, meetMode, selectedTrack } =
    useSession();
  const identity = participant?.identity;
  const isLocal = participant?.isLocal ?? false;
  const score = identity ? (scores.get(identity) ?? 0) : 0;
  const active = phase === "playing" || phase === "countdown";
  const showGameOverlays = !meetMode;

  const camPub = participant?.getTrackPublication(Track.Source.Camera);
  const hasVideo = !!camPub?.track;

  const trackingApi = useLocalCameraTracking(
    localFrameRef,
    isLocal,
    isLocal && !meetMode,
  );

  return (
    <div
      data-dance-tile={identity}
      className="relative h-full min-h-0 w-full overflow-hidden rounded-xl bg-black"
    >
      {hasVideo ? (
        <div
          className="absolute inset-0 transition-[filter] duration-300"
          style={{
            filter:
              active && !meetMode ? tileVideoFilter(score, isLocal) : "none",
          }}
        >
          <div
            ref={(el) => trackingApi.register(el)}
            className="absolute inset-0"
          >
            <AttachedVideo publication={camPub} />
            {isLocal && showGameOverlays && <BodyAura />}
          </div>
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
      {isLocal &&
        phase === "idle" &&
        !meetMode &&
        selectedTrack?.videoUrl &&
        hasVideo && (
          <LobbyPreview
            key={selectedTrack.videoUrl}
            videoUrl={selectedTrack.videoUrl}
          />
        )}
      {isLocal && active && !meetMode && selectedTrack?.videoUrl && (
        <ReferenceVideoStage videoUrl={selectedTrack.videoUrl} />
      )}
      {showGameOverlays && (
        <>
          <PlayerTint identity={identity} active={active} />
          <ScoreOverlay />
          <FlowPill identity={identity} />
        </>
      )}
      {meetMode && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-200 backdrop-blur">
          {participant?.name || identity?.slice(0, 10) || "guest"}
          {isLocal ? " · you" : ""}
        </div>
      )}
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
  let cols: number;
  let rows: number;
  if (n === 1) {
    cols = 1;
    rows = 1;
  } else if (n === 2) {
    cols = 2;
    rows = 1;
  } else if (n === 3) {
    cols = 3;
    rows = 1;
  } else if (n === 4) {
    cols = 2;
    rows = 2;
  } else if (n <= 6) {
    cols = 3;
    rows = 2;
  } else if (n <= 9) {
    cols = 3;
    rows = 3;
  } else {
    cols = 4;
    rows = Math.ceil(n / 4);
  }

  return (
    <div
      className="grid h-full w-full gap-2"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
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
  const { match, phase, secondsElapsed, roomName, meetMode, selectedTrack } =
    useSession();
  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      <header className="flex items-center justify-between px-4 py-3 text-xs uppercase tracking-widest opacity-70">
        <span>
          VibeCheque · {meetMode ? "chill room" : (roomName ?? "lobby")}
        </span>
        <Link href="/" className="text-zinc-400 hover:text-white">
          leave
        </Link>
      </header>
      <div className="relative flex-1 min-h-0 overflow-hidden px-2 pb-2">
        <Stage />
        <MatchHUD />
      </div>
      <RoomAudioRenderer />
      <SyncedMusic
        match={match}
        phase={phase}
        secondsElapsed={secondsElapsed}
        audioUrl={selectedTrack?.audioUrl ?? null}
      />
      {!meetMode && <BeatPulse />}
    </div>
  );
}

export default function RoomPage() {
  const { user, ready, authenticated } = usePrivy();

  // Stable identity for this session: survive Privy re-hydration so we
  // don't ping-pong between lobby rooms.
  const [guestFallback] = useState(
    () => `guest-${Math.random().toString(36).slice(2, 10)}`,
  );
  const identity = useMemo(() => {
    if (!ready) return null;
    return user?.wallet?.address ?? user?.id ?? guestFallback;
  }, [ready, user, guestFallback]);
  const displayName = useMemo(() => {
    if (!identity) return undefined;
    return user?.email?.address ?? identity.slice(0, 10);
  }, [identity, user]);

  const lobby = useLobby(identity, displayName);

  const [token, setToken] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch a LiveKit token for whichever room the lobby assigned us to
  useEffect(() => {
    if (!lobby.roomName || !identity) return;
    const params = new URLSearchParams({
      identity,
      name: displayName ?? identity,
      room: lobby.roomName,
    });
    let cancelled = false;
    fetch(`/api/livekit-token?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((data: { token: string; url: string }) => {
        if (cancelled) return;
        setToken(data.token);
        setWsUrl(data.url);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [lobby.roomName, identity, displayName]);

  // Keep `authenticated` referenced for linters
  void authenticated;

  if (!ready) {
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

  if (!lobby.roomName) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-fuchsia-200 animate-pulse">
          finding a room…
        </p>
      </main>
    );
  }

  if (!token || !wsUrl) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-400 animate-pulse">
          connecting to {lobby.roomName}…
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <LiveKitRoom
        token={token}
        serverUrl={wsUrl}
        connect
        video
        audio={false}
        data-lk-theme="default"
        className="flex-1"
      >
        <SessionProvider lobby={lobby}>
          <RoomInner />
        </SessionProvider>
      </LiveKitRoom>
    </main>
  );
}
