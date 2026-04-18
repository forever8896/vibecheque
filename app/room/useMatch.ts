"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type Match = { id: string; startAt: number; duration: number };
export type MatchPhase = "idle" | "countdown" | "playing" | "ended";

export function useMatch(opts?: { onMatchAnnounce?: (m: Match) => void }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [serverOffset, setServerOffset] = useState(0); // serverNow - clientNow
  const [tick, setTick] = useState(() => Date.now());

  // Poll the server every 2s as a safety net
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/match", { cache: "no-store" });
        if (!r.ok) return;
        const data: { match: Match | null; serverNow: number } = await r.json();
        if (cancelled) return;
        setMatch(data.match);
        setServerOffset(data.serverNow - Date.now());
      } catch {
        // ignore transient network errors
      }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Local clock at 100ms resolution
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now() + serverOffset), 100);
    return () => clearInterval(id);
  }, [serverOffset]);

  const startMatch = useCallback(
    async (duration?: number) => {
      const r = await fetch("/api/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ duration }),
      });
      if (!r.ok) return null;
      const data: { match: Match; serverNow: number } = await r.json();
      setMatch(data.match);
      setServerOffset(data.serverNow - Date.now());
      opts?.onMatchAnnounce?.(data.match);
      return data.match;
    },
    [opts],
  );

  // Accept a match pushed via LiveKit data channel — skips the 2s poll wait
  const ingestBroadcast = useCallback((m: Match, serverNow?: number) => {
    setMatch(m);
    if (typeof serverNow === "number") {
      setServerOffset(serverNow - Date.now());
    }
  }, []);

  const derived = useMemo(() => {
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
        progress = Math.min(
          1,
          (now - match.startAt) / match.duration,
        );
      } else {
        phase = "ended";
      }
    }

    return { phase, secondsToStart, secondsElapsed, secondsRemaining, progress };
  }, [match, tick]);

  return {
    match,
    ...derived,
    startMatch,
    ingestBroadcast,
  };
}
