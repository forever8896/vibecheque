import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // pose extraction is slow; give it 5 minutes

// Trust-based demo upload: anyone can POST a video + title, we save it to
// .uploads/<uuid>/<filename>, spawn the existing ingest shell script, and
// the new track shows up in public/tracks/<id>/ + index.json. The ingest
// script hashes the absolute path with sha1 to derive the track id, so we
// recompute the same hash up front to predict the resulting id and return
// it on success.

const MAX_BYTES = 300 * 1024 * 1024; // 300 MB cap — dance clips shouldn't be movies

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }
  const file = form.get("video");
  const titleRaw = form.get("title");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "missing 'video' file field" },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `file too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)`,
      },
      { status: 413 },
    );
  }
  if (file.type && !file.type.startsWith("video/")) {
    return NextResponse.json(
      { error: `unsupported content-type: ${file.type}` },
      { status: 415 },
    );
  }

  const cwd = process.cwd();
  const uploadId = randomUUID();
  const uploadDir = path.join(cwd, ".uploads", uploadId);
  const safeName = sanitizeFilename(file.name || "upload.mp4");
  const uploadPath = path.join(uploadDir, safeName);

  const title =
    typeof titleRaw === "string" && titleRaw.trim()
      ? titleRaw.trim().slice(0, 120)
      : safeName.replace(/\.[^.]+$/, "");

  await mkdir(uploadDir, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(uploadPath, bytes);

  // Mirror the shell-side `sha1sum | cut -c1-8` over the absolute path so
  // we know the id without having to parse the script output.
  const predictedId = createHash("sha1")
    .update(uploadPath)
    .digest("hex")
    .slice(0, 8);

  try {
    const { stdout, stderr, code } = await runIngest(uploadPath, title);
    if (code !== 0) {
      console.error("[track-upload] ingest failed", {
        code,
        stderr: stderr.slice(-2000),
      });
      return NextResponse.json(
        {
          ok: false,
          error: `ingest failed (exit ${code})`,
          detail: tailLines(stderr, 10),
        },
        { status: 500 },
      );
    }
    const parsedId = parseTrackId(stdout) ?? predictedId;
    return NextResponse.json({ ok: true, trackId: parsedId, title });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[track-upload] spawn error", msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  } finally {
    await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
  }
}

function sanitizeFilename(name: string): string {
  // Strip path separators and weird chars. Keep extension.
  const basename = name.replace(/[/\\]/g, "_");
  const clean = basename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return clean.length > 0 ? clean : "upload.mp4";
}

function runIngest(
  videoPath: string,
  title: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), "scripts", "ingest-track.sh");
    const proc = spawn("bash", [script, videoPath, "--title", title], {
      cwd: process.cwd(),
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

function parseTrackId(stdout: string): string | null {
  // "✓ track ingested: <id>" — match the 8-hex id.
  const m = stdout.match(/track ingested:\s*([0-9a-f]{8})/i);
  return m ? m[1] : null;
}

function tailLines(s: string, n: number): string {
  const lines = s.trim().split("\n");
  return lines.slice(-n).join("\n");
}
