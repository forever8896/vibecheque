// Server-side tracks data-store. Two backends, chosen by env:
//
//   Redis (prod): when UPSTASH_REDIS_REST_URL + _TOKEN are set, persist
//     TrackRecord rows in Upstash. Used for Vercel deploys where the
//     filesystem is ephemeral.
//
//   Filesystem (dev): when Redis isn't configured, read/write
//     public/tracks/index.json + public/tracks/<id>/*, matching the
//     original self-contained local dev flow.
//
// Track records always carry absolute URLs (videoUrl/audioUrl/etc.), so
// the client renderers don't have to care which backend wrote them.

import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

export type TrackStatus = "uploading" | "queued" | "processing" | "ready" | "failed";

export type TrackRecord = {
  id: string;
  title: string;
  uploader?: string;
  status: TrackStatus;
  error?: string;
  source?: string;
  durationMs?: number;
  frames?: number;
  videoUrl?: string;
  audioUrl?: string;
  choreoUrl?: string;
  coverUrl?: string;
  // `sourceBlobUrl` is the raw upload on Blob — the worker downloads
  // this, processes, and replaces video/audio/choreo/cover URLs with the
  // normalized outputs.
  sourceBlobUrl?: string;
  createdAt: number;
  readyAt?: number;
};

const REDIS_TRACKS_SET = "vibecheque:tracks:ids";
const REDIS_TRACK_KEY = (id: string) => `vibecheque:track:${id}`;

function redisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function redisEnabled(): boolean {
  return redisClient() !== null;
}

// -- PUBLIC API --------------------------------------------------------

export async function listTracks(): Promise<TrackRecord[]> {
  const redis = redisClient();
  if (redis) {
    const ids = (await redis.smembers(REDIS_TRACKS_SET)) as string[];
    if (ids.length === 0) return [];
    const pipeline = redis.pipeline();
    for (const id of ids) pipeline.get(REDIS_TRACK_KEY(id));
    const rows = (await pipeline.exec()) as (TrackRecord | null)[];
    return rows
      .filter((r): r is TrackRecord => r !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  return fsListTracks();
}

export async function getTrack(id: string): Promise<TrackRecord | null> {
  const redis = redisClient();
  if (redis) {
    const row = (await redis.get(REDIS_TRACK_KEY(id))) as TrackRecord | null;
    return row ?? null;
  }
  const all = await fsListTracks();
  return all.find((t) => t.id === id) ?? null;
}

export async function putTrack(rec: TrackRecord): Promise<void> {
  const redis = redisClient();
  if (redis) {
    await redis.set(REDIS_TRACK_KEY(rec.id), rec);
    await redis.sadd(REDIS_TRACKS_SET, rec.id);
    return;
  }
  // Filesystem backend is written to by the local ingest script, not by
  // API routes. Still support direct put for parity / tests.
  await fsPutTrack(rec);
}

export async function patchTrack(
  id: string,
  patch: Partial<TrackRecord>,
): Promise<TrackRecord | null> {
  const cur = await getTrack(id);
  if (!cur) return null;
  const next: TrackRecord = { ...cur, ...patch };
  await putTrack(next);
  return next;
}

export async function deleteTrack(id: string): Promise<void> {
  const redis = redisClient();
  if (redis) {
    await redis.del(REDIS_TRACK_KEY(id));
    await redis.srem(REDIS_TRACKS_SET, id);
    return;
  }
  // No filesystem delete in this store — operators can rm the dir
  // manually if they want.
}

// -- FILESYSTEM FALLBACK ----------------------------------------------
// Reads the existing `public/tracks/index.json` and synthesizes absolute
// URLs pointing at `/tracks/<id>/...` so the filesystem layout produced
// by scripts/ingest-track.sh is readable through the same record shape.

type FsIndexEntry = {
  id: string;
  title: string;
  uploader?: string;
  durationMs?: number;
  frames?: number;
  source?: string;
  hasVideo?: boolean;
};

type FsIndex = { tracks: FsIndexEntry[] };

const FS_INDEX_PATH = path.join(process.cwd(), "public", "tracks", "index.json");

async function fsReadIndex(): Promise<FsIndex> {
  try {
    const text = await fs.readFile(FS_INDEX_PATH, "utf8");
    const parsed = JSON.parse(text) as FsIndex;
    return { tracks: Array.isArray(parsed?.tracks) ? parsed.tracks : [] };
  } catch {
    return { tracks: [] };
  }
}

async function fsWriteIndex(idx: FsIndex): Promise<void> {
  await fs.mkdir(path.dirname(FS_INDEX_PATH), { recursive: true });
  await fs.writeFile(FS_INDEX_PATH, JSON.stringify(idx, null, 2));
}

async function fsListTracks(): Promise<TrackRecord[]> {
  const { tracks } = await fsReadIndex();
  return tracks.map((t) => fsEntryToRecord(t));
}

async function fsPutTrack(rec: TrackRecord): Promise<void> {
  const { tracks } = await fsReadIndex();
  const filtered = tracks.filter((t) => t.id !== rec.id);
  filtered.push({
    id: rec.id,
    title: rec.title,
    uploader: rec.uploader,
    durationMs: rec.durationMs,
    frames: rec.frames,
    source: rec.source,
    hasVideo: !!rec.videoUrl,
  });
  await fsWriteIndex({ tracks: filtered });
}

function fsEntryToRecord(e: FsIndexEntry): TrackRecord {
  return {
    id: e.id,
    title: e.title,
    uploader: e.uploader,
    status: "ready",
    source: e.source,
    durationMs: e.durationMs,
    frames: e.frames,
    videoUrl: e.hasVideo ? `/tracks/${e.id}/video.mp4` : undefined,
    audioUrl: `/tracks/${e.id}/audio.mp3`,
    choreoUrl: `/tracks/${e.id}/choreo.json`,
    coverUrl: `/tracks/${e.id}/cover.jpg`,
    createdAt: 0,
    readyAt: 0,
  };
}
