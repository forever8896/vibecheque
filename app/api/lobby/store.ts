// Shared in-memory lobby state. Works in dev (single process) and on a
// warm Vercel function. Cold starts will wipe this; acceptable for the
// hackathon, would need Upstash/Redis later.

export type Match = {
  id: string;
  startAt: number;
  duration: number;
};

export type Room = {
  name: string;
  createdAt: number;
  participants: Map<string, { lastSeenAt: number; name?: string }>;
  locked: boolean;
  match: Match | null;
  // Id that the *next* match will use — players can pre-stake into it
  nextMatchId: string;
  // Track chosen for the next match
  selectedTrackId: string | null;
};

export const ROOM_MAX = 4;
export const PARTICIPANT_TTL_MS = 12_000;
export const DEFAULT_MATCH_DURATION_MS = 45_000;
export const COUNTDOWN_MS = 5_000;
export const UNLOCK_GRACE_MS = 30_000;

// Use globalThis so HMR doesn't rotate the Map between route handler reloads
const g = globalThis as unknown as { __vibecheque_rooms?: Map<string, Room> };
export const rooms: Map<string, Room> =
  g.__vibecheque_rooms ?? (g.__vibecheque_rooms = new Map());

// Async default-track lookup — reads from the tracks store (Redis or
// filesystem fallback). Memoized per process, refreshed after TTL so an
// ingest completing after boot still picks up a new default eventually.
let defaultTrackId: string | null | undefined;
let defaultTrackAt = 0;
const DEFAULT_TTL_MS = 30_000;

export async function getDefaultTrackId(): Promise<string | null> {
  const now = Date.now();
  if (defaultTrackId !== undefined && now - defaultTrackAt < DEFAULT_TTL_MS) {
    return defaultTrackId;
  }
  try {
    const { listTracks } = await import("@/lib/tracksStore");
    const tracks = await listTracks();
    const ready = tracks.find((t) => t.status === "ready") ?? tracks[0];
    defaultTrackId = ready?.id ?? null;
  } catch {
    defaultTrackId = null;
  }
  defaultTrackAt = now;
  return defaultTrackId;
}

export function prune(now: number = Date.now()) {
  for (const room of rooms.values()) {
    for (const [id, p] of room.participants) {
      if (now - p.lastSeenAt > PARTICIPANT_TTL_MS) {
        room.participants.delete(id);
      }
    }
    if (
      room.match &&
      now > room.match.startAt + room.match.duration + UNLOCK_GRACE_MS
    ) {
      room.match = null;
      room.locked = false;
      // Rotate to a fresh match id so old stakes don't spill into the next game
      room.nextMatchId = randomMatchId();
    }
  }
  for (const [name, room] of rooms) {
    if (room.participants.size === 0 && !room.match) {
      rooms.delete(name);
    }
  }
}

export function snapshot(room: Room, now: number) {
  return {
    roomName: room.name,
    participants: room.participants.size,
    participantIds: [...room.participants.keys()],
    locked: room.locked,
    maxPlayers: ROOM_MAX,
    match: room.match,
    nextMatchId: room.nextMatchId,
    selectedTrackId: room.selectedTrackId,
    serverNow: now,
  };
}

// One shared LiveKit room for the whole product. On Vercel every
// serverless instance has its own rooms Map, so randomized per-instance
// room names used to hand different players different LiveKit tokens —
// they'd each end up alone in their own SFU room. Pinning everyone to
// a single room name here makes sure anyone in the lobby can actually
// see each other. The in-memory participant counter is still
// per-instance (imperfect until we move to Redis), but the video
// session itself is authoritative via LiveKit.
export const SHARED_ROOM_NAME = process.env.SHARED_ROOM_NAME || "vibecheque-main";

export function randomMatchId() {
  return Math.random().toString(36).slice(2, 10);
}

export async function findOrAssign(
  identity: string,
  displayName: string | undefined,
): Promise<Room> {
  const now = Date.now();
  let room = rooms.get(SHARED_ROOM_NAME);
  if (!room) {
    room = {
      name: SHARED_ROOM_NAME,
      createdAt: now,
      participants: new Map(),
      locked: false,
      match: null,
      nextMatchId: randomMatchId(),
      selectedTrackId: await getDefaultTrackId(),
    };
    rooms.set(room.name, room);
  }
  const existing = room.participants.get(identity);
  if (existing) {
    existing.lastSeenAt = now;
    if (displayName) existing.name = displayName;
  } else {
    room.participants.set(identity, { lastSeenAt: now, name: displayName });
  }
  return room;
}
