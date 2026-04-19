"use client";

import { useCallback, useEffect, useState } from "react";

export type TrackStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "ready"
  | "failed";

export type TrackSummary = {
  id: string;
  title: string;
  uploader?: string;
  durationMs?: number;
  frames?: number;
  source?: string;
  status: TrackStatus;
  error?: string;
  videoUrl?: string;
  audioUrl?: string;
  choreoUrl?: string;
  coverUrl?: string;
  createdAt?: number;
  readyAt?: number;
};

export function useTracks(): {
  tracks: TrackSummary[];
  ready: boolean;
  refetch: () => void;
} {
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tracks", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((data) => {
        if (cancelled) return;
        setTracks(Array.isArray(data?.tracks) ? data.tracks : []);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setTracks([]);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { tracks, ready, refetch };
}
