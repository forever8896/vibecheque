"use client";

import { useEffect, useState } from "react";

export type TrackSummary = {
  id: string;
  title: string;
  uploader?: string;
  durationMs?: number;
  frames?: number;
  source?: string;
};

export function useTracks(): { tracks: TrackSummary[]; ready: boolean } {
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/tracks/index.json", { cache: "force-cache" })
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
  }, []);

  return { tracks, ready };
}
