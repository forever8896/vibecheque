import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tells the client which upload flow to use. The cloud flow needs all
// three (Vercel Blob token, Railway worker URL, shared secret with the
// worker) — if any is missing we fall back to the local multipart
// /api/track-upload route so dev still works.
export async function GET() {
  const cloudUploads = !!(
    process.env.BLOB_READ_WRITE_TOKEN &&
    process.env.WORKER_URL &&
    process.env.WORKER_SECRET
  );
  return NextResponse.json({ cloudUploads });
}
