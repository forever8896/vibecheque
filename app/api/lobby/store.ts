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
    serverNow: now,
  };
}

export function randomRoomName() {
  return `vibecheque-${Math.random().toString(36).slice(2, 8)}`;
}

export function findOrAssign(
  identity: string,
  displayName: string | undefined,
): Room {
  const now = Date.now();
  for (const room of rooms.values()) {
    const existing = room.participants.get(identity);
    if (existing) {
      existing.lastSeenAt = now;
      if (displayName) existing.name = displayName;
      return room;
    }
  }
  for (const room of rooms.values()) {
    if (!room.locked && room.participants.size < ROOM_MAX) {
      room.participants.set(identity, {
        lastSeenAt: now,
        name: displayName,
      });
      return room;
    }
  }
  const room: Room = {
    name: randomRoomName(),
    createdAt: now,
    participants: new Map([[identity, { lastSeenAt: now, name: displayName }]]),
    locked: false,
    match: null,
  };
  rooms.set(room.name, room);
  return room;
}
