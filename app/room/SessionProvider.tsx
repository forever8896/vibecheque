"use client";

import {
  useLocalParticipant,
  useMaybeRoomContext,
} from "@livekit/components-react";
import {
  ConnectionState,
  LocalVideoTrack,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from "livekit-client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Match, MatchPhase } from "./useMatch";
import { useMatch } from "./useMatch";
import { usePoseScore, type PoseFrame } from "./usePoseScore";

type Session = {
  scores: Map<string, number>;
  totals: Map<string, number>;
  match: Match | null;
  phase: MatchPhase;
  secondsToStart: number;
  secondsElapsed: number;
  secondsRemaining: number;
  progress: number;
  startMatch: (duration?: number) => Promise<Match | null>;
  localFrameRef: React.RefObject<PoseFrame | null>;
};

const noopRef = { current: null } as React.RefObject<PoseFrame | null>;

const SessionContext = createContext<Session>({
  scores: new Map(),
  totals: new Map(),
  match: null,
  phase: "idle",
  secondsToStart: 0,
  secondsElapsed: 0,
  secondsRemaining: 0,
  progress: 0,
  startMatch: async () => null,
  localFrameRef: noopRef,
});

export function useSession() {
  return useContext(SessionContext);
}

type WireMessage =
  | { type: "score"; score: number }
  | { type: "match"; match: Match; serverNow: number };

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const room = useMaybeRoomContext();
  const { localParticipant } = useLocalParticipant();

  const [scores, setScores] = useState<Map<string, number>>(new Map());
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const totalsMatchIdRef = useRef<string | null>(null);

  const {
    match,
    phase,
    secondsToStart,
    secondsElapsed,
    secondsRemaining,
    progress,
    startMatch: startMatchBase,
    ingestBroadcast,
  } = useMatch();

  // Resolve the local camera MediaStreamTrack
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

  const { score: myScore, frameRef: localFrameRef } = usePoseScore(localTrack);

  // Reflect my own score in the shared map
  useEffect(() => {
    if (!localParticipant) return;
    setScores((prev) => {
      if (prev.get(localParticipant.identity) === myScore) return prev;
      const next = new Map(prev);
      next.set(localParticipant.identity, myScore);
      return next;
    });
  }, [localParticipant, myScore]);

  // Accumulate totals during a playing match. Reset on new match id.
  useEffect(() => {
    if (phase !== "playing" || !match) return;
    if (totalsMatchIdRef.current !== match.id) {
      totalsMatchIdRef.current = match.id;
      setTotals(new Map());
    }
  }, [phase, match]);

  // Fold instant scores into totals at ~2 Hz while playing
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      setTotals((prev) => {
        const next = new Map(prev);
        for (const [identity, s] of scores) {
          next.set(identity, (next.get(identity) ?? 0) + s);
        }
        return next;
      });
    }, 500);
    return () => clearInterval(id);
  }, [phase, scores]);

  // Broadcast my score every 500ms
  useEffect(() => {
    if (!localParticipant || !room) return;
    const encoder = new TextEncoder();
    const id = setInterval(() => {
      if (room.state !== ConnectionState.Connected) return;
      const msg: WireMessage = { type: "score", score: myScore };
      try {
        localParticipant.publishData(encoder.encode(JSON.stringify(msg)), {
          reliable: false,
        });
      } catch {
        // engine torn down mid-tick — cleanup will clear this interval
      }
    }, 500);
    return () => clearInterval(id);
  }, [room, localParticipant, myScore]);

  // Receive remote messages (scores + match announcements)
  useEffect(() => {
    if (!room) return;
    const decoder = new TextDecoder();
    const onData = (payload: Uint8Array, participant?: RemoteParticipant) => {
      let msg: WireMessage;
      try {
        msg = JSON.parse(decoder.decode(payload)) as WireMessage;
      } catch {
        return;
      }
      if (msg.type === "score" && participant) {
        setScores((prev) => {
          const next = new Map(prev);
          next.set(participant.identity, msg.score);
          return next;
        });
      } else if (msg.type === "match" && msg.match) {
        ingestBroadcast(msg.match, msg.serverNow);
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, ingestBroadcast]);

  // Wrap startMatch to also broadcast to peers
  const startMatch = useCallback(
    async (duration?: number) => {
      const m = await startMatchBase(duration);
      if (m && localParticipant && room?.state === ConnectionState.Connected) {
        const msg: WireMessage = {
          type: "match",
          match: m,
          serverNow: Date.now(),
        };
        try {
          localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify(msg)),
            { reliable: true },
          );
        } catch {
          // engine not ready; peers will still pick the match up via the 2s poll
        }
      }
      return m;
    },
    [startMatchBase, localParticipant, room],
  );

  const value = useMemo(
    () => ({
      scores,
      totals,
      match,
      phase,
      secondsToStart,
      secondsElapsed,
      secondsRemaining,
      progress,
      startMatch,
      localFrameRef,
    }),
    [
      scores,
      totals,
      match,
      phase,
      secondsToStart,
      secondsElapsed,
      secondsRemaining,
      progress,
      startMatch,
      localFrameRef,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
