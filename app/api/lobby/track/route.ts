import { NextRequest, NextResponse } from "next/server";
import { prune, rooms, snapshot } from "../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/lobby/track
// Body: { roomName, trackId }
// Anyone in an unlocked room can swap the track for the next match.
export async function POST(req: NextRequest) {
  prune();
  const body = (await req.json().catch(() => ({}))) as {
    roomName?: string;
    trackId?: string;
  };
  const roomName = typeof body.roomName === "string" ? body.roomName : "";
  const trackId = typeof body.trackId === "string" ? body.trackId : "";
  if (!roomName || !trackId) {
    return NextResponse.json(
      { error: "roomName + trackId required" },
      { status: 400 },
    );
  }
  const room = rooms.get(roomName);
  if (!room) {
    return NextResponse.json({ error: "room not found" }, { status: 404 });
  }
  // Don't let a running/locked match change mid-flight
  if (room.locked) {
    return NextResponse.json(
      { error: "room locked" },
      { status: 409 },
    );
  }
  room.selectedTrackId = trackId;
  return NextResponse.json(snapshot(room, Date.now()));
}
