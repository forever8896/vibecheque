import { NextRequest, NextResponse } from "next/server";
import { patchTrack } from "@/lib/tracksStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Railway worker POSTs here when an ingest job progresses or
// finishes. Auth via shared WORKER_SECRET header.
//
//   headers:  x-worker-secret: <shared>
//   body:     {
//     trackId: string,
//     status: "processing" | "ready" | "failed",
//     error?: string,
//     videoUrl?: string, audioUrl?: string,
//     choreoUrl?: string, coverUrl?: string,
//     durationMs?: number, frames?: number,
//     uploader?: string, source?: string,
//   }
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-worker-secret");
  if (!secret || secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    trackId?: string;
    status?: "processing" | "ready" | "failed";
    error?: string;
    videoUrl?: string;
    audioUrl?: string;
    choreoUrl?: string;
    coverUrl?: string;
    durationMs?: number;
    frames?: number;
    uploader?: string;
    source?: string;
  } | null;
  if (!body?.trackId || !body.status) {
    return NextResponse.json({ error: "trackId + status required" }, { status: 400 });
  }
  const updated = await patchTrack(body.trackId, {
    status: body.status,
    error: body.error,
    videoUrl: body.videoUrl,
    audioUrl: body.audioUrl,
    choreoUrl: body.choreoUrl,
    coverUrl: body.coverUrl,
    durationMs: body.durationMs,
    frames: body.frames,
    uploader: body.uploader,
    source: body.source,
    readyAt: body.status === "ready" ? Date.now() : undefined,
  });
  if (!updated) {
    return NextResponse.json({ error: "track not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
