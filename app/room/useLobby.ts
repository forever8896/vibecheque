"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type Match = { id: string; startAt: number; duration: number };
export type MatchPhase = "idle" | "countdown" | "playing" | "ended";

type LobbySnapshot = {
  roomName: string;
  participants: number;
  participantIds: string[];
  locked: boolean;
  maxPlayers: number;
  match: Match | null;
  serverNow: number;
};

export type Lobby = {
  roomName: string | null;
  participants: number;
  maxPlayers: number;
  locked: boolean;
  match: Match | null;
  phase: MatchPhase;
  secondsToStart: number;
  secondsElapsed: number;
  secondsRemaining: number;
  progress: number;
  startMatch: (duration?: number) => Promise<Match | null>;
  ingestBroadcast: (match: Match, serverNow?: number) => void;
};

const HEARTBEAT_MS = 4_000;

export function useLobby(
  identity: string | null,
  name: string | undefined,
): Lobby {
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const identityRef = useRef(identity);
  identityRef.current = identity;

  // Heartbeat-based presence + state polling
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;

    async function beat() {
      try {
        const r = await fetch("/api/lobby", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identity, name }),
          cache: "no-store",
        });
        if (!r.ok) return;
        const data = (await r.json()) as LobbySnapshot;
        if (cancelled) return;
        setSnapshot(data);
        setServerOffset(data.serverNow - Date.now());
      } catch {
        /* transient, next heartbeat will retry */
      }
    }

    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [identity, name]);

  // Best-effort leave on unmount
  useEffect(() => {
    return () => {
      const id = identityRef.current;
      if (!id) return;
      try {
        const blob = new Blob([JSON.stringify({ identity: id })], {
          type: "application/json",
        });
        // sendBeacon survives page unload
        navigator.sendBeacon?.("/api/lobby", blob);
      } catch {
        /* noop */
      }
    };
  }, []);

  // Local clock (100ms resolution) used for phase derivations
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now() + serverOffset), 100);
    return () => clearInterval(id);
  }, [serverOffset]);

  const startMatch = useCallback(
    async (duration?: number): Promise<Match | null> => {
      const snap = snapshot;
      if (!snap) return null;
      try {
        const r = await fetch("/api/lobby/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomName: snap.roomName, duration }),
        });
        if (!r.ok) return null;
        const data = (await r.json()) as LobbySnapshot;
        setSnapshot(data);
        setServerOffset(data.serverNow - Date.now());
        return data.match;
      } catch {
        return null;
      }
    },
    [snapshot],
  );

  const ingestBroadcast = useCallback(
    (match: Match, serverNow?: number) => {
      setSnapshot((prev) =>
        prev ? { ...prev, match, locked: true } : prev,
      );
      if (typeof serverNow === "number") {
        setServerOffset(serverNow - Date.now());
      }
    },
    [],
  );

  const derived = useMemo(() => {
    const match = snapshot?.match ?? null;
    const now = tick;
    let phase: MatchPhase = "idle";
    let secondsToStart = 0;
    let secondsElapsed = 0;
    let secondsRemaining = 0;
    let progress = 0;
    if (match) {
      if (now < match.startAt) {
        phase = "countdown";
        secondsToStart = Math.max(0, Math.ceil((match.startAt - now) / 1000));
      } else if (now < match.startAt + match.duration) {
        phase = "playing";
        secondsElapsed = (now - match.startAt) / 1000;
        secondsRemaining = Math.max(
          0,
          Math.ceil((match.startAt + match.duration - now) / 1000),
        );
        progress = Math.min(1, (now - match.startAt) / match.duration);
      } else {
        phase = "ended";
      }
    }
    return { phase, secondsToStart, secondsElapsed, secondsRemaining, progress };
  }, [snapshot?.match, tick]);

  return {
    roomName: snapshot?.roomName ?? null,
    participants: snapshot?.participants ?? 0,
    maxPlayers: snapshot?.maxPlayers ?? 4,
    locked: snapshot?.locked ?? false,
    match: snapshot?.match ?? null,
    ...derived,
    startMatch,
    ingestBroadcast,
  };
}
