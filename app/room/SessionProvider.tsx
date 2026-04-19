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
import type { Lobby, Match, MatchPhase } from "./useLobby";
import { usePoseScore, type PoseFrame } from "./usePoseScore";
import { onChainReady } from "@/app/chain/config";
import { useMatchLog, type MatchLog } from "./useMatchLog";
import {
  frameAt,
  frameToTarget,
  loadChoreo,
  type Choreo,
} from "./choreography";
import type { PoseTarget } from "./poseLibrary";
import { useTracks, type TrackSummary } from "./useTracks";

type Session = {
  scores: Map<string, number>;
  totals: Map<string, number>;
  winnings: Map<string, number>;
  flowRates: Map<string, number>;
  buyIn: number;
  match: Match | null;
  phase: MatchPhase;
  secondsToStart: number;
  secondsElapsed: number;
  secondsRemaining: number;
  progress: number;
  startMatch: (duration?: number) => Promise<Match | null>;
  localFrameRef: React.RefObject<PoseFrame | null>;
  roomName: string | null;
  participants: number;
  maxPlayers: number;
  lobbyLocked: boolean;
  nextMatchId: string | null;
  activeMatchId: string | null;
  selectedTrackId: string | null;
  selectedTrack: TrackSummary | null;
  selectTrack: (trackId: string) => Promise<boolean>;
  meetMode: boolean;
  enterMeet: () => void;
  exitMeet: () => void;
  matchLog: MatchLog | null;
};

const noopRef = { current: null } as React.RefObject<PoseFrame | null>;

const BUY_IN_USD = 1;

const SessionContext = createContext<Session>({
  scores: new Map(),
  totals: new Map(),
  winnings: new Map(),
  flowRates: new Map(),
  buyIn: BUY_IN_USD,
  match: null,
  phase: "idle",
  secondsToStart: 0,
  secondsElapsed: 0,
  secondsRemaining: 0,
  progress: 0,
  startMatch: async () => null,
  localFrameRef: noopRef,
  roomName: null,
  participants: 0,
  maxPlayers: 4,
  lobbyLocked: false,
  nextMatchId: null,
  activeMatchId: null,
  selectedTrackId: null,
  selectedTrack: null,
  selectTrack: async () => false,
  meetMode: false,
  enterMeet: () => {},
  exitMeet: () => {},
  matchLog: null,
});

export function useSession() {
  return useContext(SessionContext);
}

type WireMessage =
  | { type: "score"; score: number }
  | { type: "match"; match: Match; serverNow: number };

export function SessionProvider({
  children,
  lobby,
}: {
  children: React.ReactNode;
  lobby: Lobby;
}) {
  const room = useMaybeRoomContext();
  const { localParticipant } = useLocalParticipant();

  const [scores, setScores] = useState<Map<string, number>>(new Map());
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [winnings, setWinnings] = useState<Map<string, number>>(new Map());
  const [flowRates, setFlowRates] = useState<Map<string, number>>(new Map());
  const [meetMode, setMeetMode] = useState(false);
  const settledMatchesRef = useRef<Set<string>>(new Set());

  const enterMeet = useCallback(() => setMeetMode(true), []);
  const exitMeet = useCallback(() => setMeetMode(false), []);

  // Reset meet mode whenever a new match actually starts playing
  useEffect(() => {
    if (lobby.phase === "countdown" || lobby.phase === "playing") {
      setMeetMode(false);
    }
  }, [lobby.phase]);

  // Auto-settle once per match when phase hits "ended". Convert the
  // simulated winnings map (net) into absolute payouts (buy-in + winnings
  // for winners, 0 for losers) and POST to /api/settle. Server is
  // idempotent; any peer firing first is fine.
  const winningsRef = useRef(winnings);
  winningsRef.current = winnings;
  useEffect(() => {
    if (!onChainReady()) return;
    if (lobby.phase !== "ended") return;
    const m = lobby.match;
    if (!m) return;
    if (settledMatchesRef.current.has(m.id)) return;
    settledMatchesRef.current.add(m.id);

    const entries = [...winningsRef.current.entries()];
    const BUY_IN_USD = 1;
    const payouts = entries
      .filter(([addr]) => /^0x[0-9a-fA-F]{40}$/.test(addr))
      .map(([address, net]) => ({
        address,
        amount: net > 0 ? BUY_IN_USD + net : 0,
      }));

    void fetch("/api/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId: m.id, payouts }),
    }).catch((err) => console.warn("[settle] request failed", err));
  }, [lobby.phase, lobby.match]);
  const totalsMatchIdRef = useRef<string | null>(null);
  const scoresRef = useRef(scores);
  useEffect(() => {
    scoresRef.current = scores;
  }, [scores]);

  const {
    roomName,
    participants: lobbyParticipants,
    maxPlayers,
    locked: lobbyLocked,
    nextMatchId,
    selectedTrackId,
    match,
    phase,
    secondsToStart,
    secondsElapsed,
    secondsRemaining,
    progress,
    startMatch: startMatchBase,
    ingestBroadcast,
    selectTrack,
  } = lobby;
  const activeMatchId = match?.id ?? null;

  // LiveKitRoom video prop sometimes doesn't auto-publish reliably.
  // Force-enable camera once we're connected. Microphone stays off
  // until the user opts into meet mode — the browser mic prompt
  // shouldn't fire just from entering the dance floor.
  useEffect(() => {
    if (!room || !localParticipant) return;
    if (room.state !== ConnectionState.Connected) return;
    localParticipant
      .setCameraEnabled(true)
      .catch((e) => console.warn("[room] enable camera", e));
  }, [room, localParticipant, room?.state]);

  // Toggle the mic alongside meet mode: request permission + publish
  // when entering, mute when leaving, so voice is only live in the
  // chill room.
  useEffect(() => {
    if (!room || !localParticipant) return;
    if (room.state !== ConnectionState.Connected) return;
    localParticipant
      .setMicrophoneEnabled(meetMode)
      .catch((e) => console.warn("[room] toggle mic", e));
  }, [room, localParticipant, room?.state, meetMode]);

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

  // Idle-phase dab detection is landmark-based (see dabPose.ts), so we
  // don't force the scorer onto a DAB target here.
  const forcedTargetName: string | null = null;

  // Resolve the full track record from the tracks store — gives us
  // per-track URLs (videoUrl/audioUrl/choreoUrl) the consumers need.
  const { tracks: allTracks } = useTracks();
  const selectedTrack = useMemo(
    () => allTracks.find((t) => t.id === selectedTrackId) ?? null,
    [allTracks, selectedTrackId],
  );
  const selectedChoreoUrl = selectedTrack?.choreoUrl ?? null;

  // Load choreography JSON for the currently-selected track; refresh when
  // the selection changes so ChoreoOverlay + scorer pick up the swap.
  const choreoRef = useRef<Choreo | null>(null);
  useEffect(() => {
    choreoRef.current = null;
    if (!selectedChoreoUrl) return;
    let cancelled = false;
    void loadChoreo(selectedChoreoUrl).then((c) => {
      if (!cancelled) choreoRef.current = c;
    });
    return () => {
      cancelled = true;
    };
  }, [selectedChoreoUrl]);

  // Match start time (perf-now scale) so the choreography stays aligned
  const matchStartPerfRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      lobby.match &&
      (lobby.phase === "playing" || lobby.phase === "countdown")
    ) {
      // Map the match's startAt (wall clock ms) to our local perf-now clock
      const offset = Date.now() - performance.now();
      matchStartPerfRef.current = lobby.match.startAt - offset;
    } else {
      matchStartPerfRef.current = null;
    }
  }, [lobby.match, lobby.phase]);

  // Choreo provider — resolves to a PoseTarget for the current match time
  // during playing. Returns null any other time so the default rotation or
  // forced-pose logic stays in charge.
  const getTarget = useCallback((ts: number): PoseTarget | null => {
    const choreo = choreoRef.current;
    const startAt = matchStartPerfRef.current;
    if (!choreo || startAt == null) return null;
    const elapsed = ts - startAt;
    if (elapsed < 0) return null;
    const frame = frameAt(choreo, elapsed);
    if (!frame) return null;
    return frameToTarget(frame);
  }, []);

  const { score: myScore, frameRef: localFrameRef } = usePoseScore(
    localTrack,
    { forcedTargetName, getTarget },
  );

  const matchLog = useMatchLog({
    phase: lobby.phase,
    matchId: lobby.match?.id ?? null,
    matchStartAt: lobby.match?.startAt ?? null,
    matchDurationMs: lobby.match?.duration ?? null,
    roomName: lobby.roomName,
    frameRef: localFrameRef,
  });

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

  // Reset per-match accumulators when a new match starts
  useEffect(() => {
    if (!match) return;
    if (totalsMatchIdRef.current !== match.id) {
      totalsMatchIdRef.current = match.id;
      setTotals(new Map());
      setWinnings(new Map());
      setFlowRates(new Map());
    }
  }, [match]);

  // Tick while playing: accumulate totals + simulate USDC streams
  useEffect(() => {
    if (phase !== "playing" || !match) return;
    const tickMs = 500;
    const perSecondOutflow = BUY_IN_USD / (match.duration / 1000);
    const tickFraction = tickMs / 1000;

    const id = setInterval(() => {
      const cur = scoresRef.current;
      const entries = [...cur.entries()];

      // Accumulate score totals
      setTotals((prev) => {
        const next = new Map(prev);
        for (const [identity, s] of entries) {
          next.set(identity, (next.get(identity) ?? 0) + s);
        }
        return next;
      });

      if (entries.length < 2) {
        setFlowRates(new Map());
        return;
      }

      entries.sort((a, b) => b[1] - a[1]);
      const losersCount = Math.floor(entries.length / 2);
      const winners = entries.slice(0, entries.length - losersCount);
      const losers = entries.slice(entries.length - losersCount);

      const poolPerSecond = losers.length * perSecondOutflow;
      const winnerRatePerSecond =
        winners.length > 0 ? poolPerSecond / winners.length : 0;
      const loserDelta = -perSecondOutflow * tickFraction;
      const winnerDelta = winnerRatePerSecond * tickFraction;

      setWinnings((prev) => {
        const next = new Map(prev);
        for (const [identity] of winners) {
          next.set(identity, (next.get(identity) ?? 0) + winnerDelta);
        }
        for (const [identity] of losers) {
          next.set(identity, (next.get(identity) ?? 0) + loserDelta);
        }
        return next;
      });

      const rates = new Map<string, number>();
      for (const [identity] of winners) rates.set(identity, winnerRatePerSecond);
      for (const [identity] of losers) rates.set(identity, -perSecondOutflow);
      setFlowRates(rates);
    }, tickMs);

    return () => clearInterval(id);
  }, [phase, match]);

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

  // Wrap startMatch to also broadcast to peers. Default the match
  // duration to the full selected track (+ 500 ms of grace so the
  // final beat doesn't get clipped by clock jitter), falling back to
  // the server's 45 s default when no explicit duration is passed
  // and no track has a known duration yet.
  const selectedTrackDurationMs = selectedTrack?.durationMs;
  const startMatch = useCallback(
    async (duration?: number) => {
      const effective =
        duration ??
        (selectedTrackDurationMs && selectedTrackDurationMs > 1000
          ? selectedTrackDurationMs + 500
          : undefined);
      const m = await startMatchBase(effective);
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
    [startMatchBase, localParticipant, room, selectedTrackDurationMs],
  );

  const value = useMemo(
    () => ({
      scores,
      totals,
      winnings,
      flowRates,
      buyIn: BUY_IN_USD,
      match,
      phase,
      secondsToStart,
      secondsElapsed,
      secondsRemaining,
      progress,
      startMatch,
      localFrameRef,
      roomName,
      participants: lobbyParticipants,
      maxPlayers,
      lobbyLocked,
      nextMatchId,
      activeMatchId,
      selectedTrackId,
      selectedTrack,
      selectTrack,
      meetMode,
      enterMeet,
      exitMeet,
      matchLog,
    }),
    [
      scores,
      totals,
      winnings,
      flowRates,
      match,
      phase,
      secondsToStart,
      secondsElapsed,
      secondsRemaining,
      progress,
      startMatch,
      localFrameRef,
      roomName,
      lobbyParticipants,
      maxPlayers,
      lobbyLocked,
      nextMatchId,
      activeMatchId,
      selectedTrackId,
      selectedTrack,
      selectTrack,
      meetMode,
      enterMeet,
      exitMeet,
      matchLog,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
