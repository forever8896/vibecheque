import { NextResponse } from "next/server";
import { listTracks } from "@/lib/tracksStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tracks = await listTracks();
    return NextResponse.json({ tracks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/tracks] list failed", msg);
    return NextResponse.json({ tracks: [], error: msg }, { status: 500 });
  }
}
