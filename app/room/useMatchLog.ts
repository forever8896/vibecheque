"use client";

import { useEffect, useRef, useState } from "react";
import type { PoseFrame } from "./usePoseScore";

export type MatchLogSample = {
  t: number; // seconds into the match
  score: number; // live similarity × 100
  similarity: number; // 0..1
  peak: number; // peak this window 0..1
  target: string; // current target pose name
  activity: number; // raw average velocity (debug)
  bass: number;
  bpm: number;
  musicOn: boolean;
};

export type MatchLog = {
  matchId: string;
  roomName: string | null;
  durationMs: number;
  startedAt: number; // epoch ms
  finishedAt: number; // epoch ms
  samples: MatchLogSample[];
};

const SAMPLE_INTERVAL_MS = 200; // 5 Hz

// Collect a sampled log of the local player's scoring internals during the
// match. We keep samples in a ref while playing, then freeze into state
// once the match ends so the settlement screen can show/copy it.
export function useMatchLog(opts: {
  phase: string;
  matchId: string | null;
  matchStartAt: number | null;
  matchDurationMs: number | null;
  roomName: string | null;
  frameRef: React.RefObject<PoseFrame | null>;
}): MatchLog | null {
  const [frozen, setFrozen] = useState<MatchLog | null>(null);
  const samplesRef = useRef<MatchLogSample[]>([]);
  const currentMatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (opts.phase !== "playing" || !opts.matchId || !opts.matchStartAt) return;
    // Fresh match → reset buffer + frozen log
    if (currentMatchIdRef.current !== opts.matchId) {
      currentMatchIdRef.current = opts.matchId;
      samplesRef.current = [];
      setFrozen(null);
    }
    const start = opts.matchStartAt;
    const id = setInterval(() => {
      const f = opts.frameRef.current;
      if (!f) return;
      const now = Date.now();
      samplesRef.current.push({
        t: +((now - start) / 1000).toFixed(2),
        score: f.score,
        similarity: +f.similarity.toFixed(3),
        peak: +f.peakSimilarity.toFixed(3),
        target: f.target?.name ?? "—",
        activity: +f.activity.toFixed(4),
        bass: +f.bassIntensity.toFixed(2),
        bpm: f.bpm,
        musicOn: f.musicOn,
      });
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [opts.phase, opts.matchId, opts.matchStartAt, opts.frameRef]);

  useEffect(() => {
    if (
      opts.phase === "ended" &&
      opts.matchId &&
      currentMatchIdRef.current === opts.matchId &&
      samplesRef.current.length > 0 &&
      (!frozen || frozen.matchId !== opts.matchId)
    ) {
      setFrozen({
        matchId: opts.matchId,
        roomName: opts.roomName,
        durationMs: opts.matchDurationMs ?? 0,
        startedAt: opts.matchStartAt ?? 0,
        finishedAt: Date.now(),
        samples: samplesRef.current.slice(),
      });
    }
  }, [
    opts.phase,
    opts.matchId,
    opts.roomName,
    opts.matchStartAt,
    opts.matchDurationMs,
    frozen,
  ]);

  return frozen;
}

export function matchLogToText(log: MatchLog): string {
  const summary = summarizeLog(log);
  return JSON.stringify({ summary, log }, null, 2);
}

function summarizeLog(log: MatchLog) {
  const s = log.samples;
  if (s.length === 0) return { note: "no samples" };
  const avgSim = s.reduce((a, x) => a + x.similarity, 0) / s.length;
  const peakSim = Math.max(...s.map((x) => x.similarity));
  const avgScore = s.reduce((a, x) => a + x.score, 0) / s.length;
  const peakScore = Math.max(...s.map((x) => x.score));
  const musicSamples = s.filter((x) => x.musicOn).length;
  const finalBpm = s[s.length - 1]?.bpm ?? 0;
  // Rough per-target peaks from the sampled peak timeline
  const peaksByTarget = new Map<string, number>();
  for (const x of s) {
    peaksByTarget.set(
      x.target,
      Math.max(peaksByTarget.get(x.target) ?? 0, x.peak),
    );
  }
  return {
    samples: s.length,
    avgSimilarity: +avgSim.toFixed(3),
    peakSimilarity: +peakSim.toFixed(3),
    avgScore: +avgScore.toFixed(1),
    peakScore,
    musicOnPct: +((musicSamples / s.length) * 100).toFixed(1),
    finalBpm,
    peaksByTarget: Object.fromEntries(
      [...peaksByTarget.entries()].map(([k, v]) => [k, +v.toFixed(2)]),
    ),
  };
}
