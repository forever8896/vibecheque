import { NextRequest, NextResponse } from "next/server";
import { findOrAssign, prune, rooms, snapshot } from "./store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Join a lobby or refresh an existing slot. Client calls this on mount
// and every ~4s as a heartbeat. Returns the room the caller is in.
export async function POST(req: NextRequest) {
  prune();
  const body = (await req.json().catch(() => ({}))) as {
    identity?: string;
    name?: string;
  };
  const identity = typeof body.identity === "string" ? body.identity : "";
  const displayName =
    typeof body.name === "string" && body.name.length > 0
      ? body.name
      : undefined;
  if (!identity) {
    return NextResponse.json({ error: "identity required" }, { status: 400 });
  }
  const room = await findOrAssign(identity, displayName);
  return NextResponse.json(snapshot(room, Date.now()));
}

// Explicit leave — best-effort. Client calls this on unmount.
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { identity?: string };
  const identity = typeof body.identity === "string" ? body.identity : "";
  if (!identity) return NextResponse.json({ ok: false });
  for (const room of rooms.values()) {
    room.participants.delete(identity);
  }
  prune();
  return NextResponse.json({ ok: true });
}
