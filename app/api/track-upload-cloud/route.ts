import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { patchTrack, putTrack } from "@/lib/tracksStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client-direct-upload flow for Vercel.
//
//   1. Client calls @vercel/blob's `upload()` with this route as
//      handleUploadUrl. Two request shapes hit this endpoint:
//
//      a) "blob.generate-client-token" — before upload. We validate,
//         mint a pre-record with status="uploading" in the tracks
//         store, return an allowedContentTypes + tokenPayload.
//
//      b) "blob.upload-completed" — webhook fired by Vercel Blob after
//         the file lands. We flip the record to "queued" and kick off
//         the Railway worker for processing.
//
// Env vars required: BLOB_READ_WRITE_TOKEN, WORKER_URL, WORKER_SECRET.
// Redis is also expected (UPSTASH_REDIS_REST_URL + _TOKEN) so records
// survive across instances.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload =
          safeJson<{ trackId?: string; title?: string }>(clientPayload) ?? {};
        const trackId = normalizeTrackId(payload.trackId);
        if (!trackId) {
          throw new Error("clientPayload.trackId required");
        }
        const title = (payload.title || pathname || "Untitled").slice(0, 120);

        await putTrack({
          id: trackId,
          title,
          status: "uploading",
          createdAt: Date.now(),
        });

        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm"],
          maximumSizeInBytes: 300 * 1024 * 1024,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ trackId, title }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = safeJson<{ trackId: string; title: string }>(tokenPayload);
        if (!payload?.trackId) return;
        await patchTrack(payload.trackId, {
          status: "queued",
          sourceBlobUrl: blob.url,
        });
        try {
          await enqueueWorker(payload.trackId, payload.title, blob.url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await patchTrack(payload.trackId, {
            status: "failed",
            error: `worker enqueue failed: ${msg}`,
          });
        }
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[track-upload-cloud] failed", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

async function enqueueWorker(
  trackId: string,
  title: string,
  sourceUrl: string,
): Promise<void> {
  const workerUrl = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  const callbackUrl = publicUrlFor("/api/track-callback");
  if (!workerUrl || !secret) throw new Error("worker not configured");
  if (!callbackUrl) throw new Error("PUBLIC_APP_URL/VERCEL_URL not set");

  const res = await fetch(`${workerUrl.replace(/\/$/, "")}/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": secret,
    },
    body: JSON.stringify({
      trackId,
      title,
      sourceUrl,
      callbackUrl,
      callbackSecret: secret,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`worker ${res.status}: ${txt.slice(0, 300)}`);
  }
}

function publicUrlFor(pathname: string): string | null {
  const explicit = process.env.PUBLIC_APP_URL;
  if (explicit) return `${explicit.replace(/\/$/, "")}${pathname}`;
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}${pathname}`;
  return null;
}

function safeJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function normalizeTrackId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  // Accept lowercase hex/dashes up to 64 chars (uuid-ish or short hex).
  if (!/^[a-f0-9-]{6,64}$/.test(trimmed)) return null;
  return trimmed;
}
