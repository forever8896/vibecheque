import { NextRequest, NextResponse } from "next/server";
import {
  COUNTDOWN_MS,
  DEFAULT_MATCH_DURATION_MS,
  prune,
  rooms,
  snapshot,
} from "../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lock a room and start a match in it. Anyone in the room can trigger.
export async function POST(req: NextRequest) {
  prune();
  const body = (await req.json().catch(() => ({}))) as {
    roomName?: string;
    duration?: number;
  };
  const roomName = typeof body.roomName === "string" ? body.roomName : "";
  if (!roomName) {
    return NextResponse.json({ error: "roomName required" }, { status: 400 });
  }
  const room = rooms.get(roomName);
  if (!room) {
    return NextResponse.json({ error: "room not found" }, { status: 404 });
  }
  const now = Date.now();
  // If there's already a live match, return current state (idempotent)
  if (
    room.match &&
    now < room.match.startAt + room.match.duration
  ) {
    return NextResponse.json(snapshot(room, now));
  }
  const duration =
    typeof body.duration === "number" && body.duration > 0
      ? Math.min(180_000, body.duration)
      : DEFAULT_MATCH_DURATION_MS;
  room.match = {
    id: Math.random().toString(36).slice(2, 10),
    startAt: now + COUNTDOWN_MS,
    duration,
  };
  room.locked = true;
  return NextResponse.json(snapshot(room, now));
}
