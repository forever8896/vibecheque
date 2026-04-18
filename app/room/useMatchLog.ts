"use client";

import { useEffect, useRef, useState } from "react";
import type { PoseFrame } from "./usePoseScore";

export type MatchLogSample = {
  t: number; // seconds into the match
  score: number;
  activity: number;
  joints: number;
  beatIn: boolean;
  beatClose: number;
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
        activity: +f.rawActivity.toFixed(2),
        joints: f.activeJoints,
        beatIn: f.inBeatWindow,
        beatClose: +f.beatCloseness.toFixed(2),
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
  const peakActivity = Math.max(...s.map((x) => x.activity));
  const avgActivity =
    s.reduce((a, x) => a + x.activity, 0) / s.length;
  const peakScore = Math.max(...s.map((x) => x.score));
  const avgScore = s.reduce((a, x) => a + x.score, 0) / s.length;
  const beatSamples = s.filter((x) => x.beatIn).length;
  const musicSamples = s.filter((x) => x.musicOn).length;
  const finalBpm = s[s.length - 1]?.bpm ?? 0;
  return {
    samples: s.length,
    avgActivity: +avgActivity.toFixed(1),
    peakActivity: +peakActivity.toFixed(1),
    avgScore: +avgScore.toFixed(1),
    peakScore,
    beatWindowPct: +((beatSamples / s.length) * 100).toFixed(1),
    musicOnPct: +((musicSamples / s.length) * 100).toFixed(1),
    finalBpm,
  };
}
