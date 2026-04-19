import express from "express";
import { put } from "@vercel/blob";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Vibecheque ingest worker. Sits behind Vercel's /api/track-upload-cloud
// route: once Vercel Blob finishes accepting the raw upload, the Next app
// POSTs us /ingest with { trackId, sourceUrl, callbackUrl, callbackSecret }.
// We download the raw file, run ffmpeg + MediaPipe pose extraction, upload
// the processed outputs back to Vercel Blob, and POST the URLs to the
// Next app's /api/track-callback. Status transitions: uploading →
// processing (we post this immediately) → ready (with URLs) or failed
// (with error text).

type IngestBody = {
  trackId?: string;
  title?: string;
  sourceUrl?: string;
  callbackUrl?: string;
  callbackSecret?: string;
};

type CallbackBody = {
  trackId: string;
  status: "processing" | "ready" | "failed";
  error?: string;
  videoUrl?: string;
  audioUrl?: string;
  choreoUrl?: string;
  coverUrl?: string;
  durationMs?: number;
  frames?: number;
};

const PORT = Number(process.env.PORT ?? 3000);
const WORKER_SECRET = requireEnv("WORKER_SECRET");
const BLOB_TOKEN = requireEnv("BLOB_READ_WRITE_TOKEN");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.send("vibecheque-worker ok");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/ingest", (req, res) => {
  if (req.headers["x-worker-secret"] !== WORKER_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = req.body as IngestBody;
  if (
    !body.trackId ||
    !body.sourceUrl ||
    !body.callbackUrl ||
    !body.callbackSecret
  ) {
    res
      .status(400)
      .json({ error: "trackId, sourceUrl, callbackUrl, callbackSecret required" });
    return;
  }
  // Accept immediately — processing is fire-and-forget, the worker
  // reports progress via the callback URL.
  res.status(202).json({ queued: true, trackId: body.trackId });
  processJob({
    trackId: body.trackId,
    title: body.title ?? "Untitled",
    sourceUrl: body.sourceUrl,
    callbackUrl: body.callbackUrl,
    callbackSecret: body.callbackSecret,
  }).catch((err) => {
    console.error(`[ingest ${body.trackId}] unhandled`, err);
  });
});

async function processJob(args: {
  trackId: string;
  title: string;
  sourceUrl: string;
  callbackUrl: string;
  callbackSecret: string;
}) {
  const { trackId, sourceUrl, callbackUrl, callbackSecret } = args;
  const tmp = await mkdtemp(path.join(tmpdir(), `ingest-${trackId}-`));
  const log = (msg: string) => console.log(`[ingest ${trackId}] ${msg}`);
  try {
    await postCallback(callbackUrl, callbackSecret, {
      trackId,
      status: "processing",
    });

    const rawPath = path.join(tmp, "raw.mp4");
    const videoPath = path.join(tmp, "video.mp4");
    const audioPath = path.join(tmp, "audio.mp3");
    const choreoPath = path.join(tmp, "choreo.json");
    const coverPath = path.join(tmp, "cover.jpg");

    log(`downloading ${sourceUrl}`);
    const resp = await fetch(sourceUrl);
    if (!resp.ok) throw new Error(`download ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    await writeFile(rawPath, buf);
    log(`downloaded ${buf.length} bytes`);

    log("ffmpeg: normalize to H.264 ≤720p");
    await runCmd("ffmpeg", [
      "-loglevel", "error", "-y",
      "-i", rawPath,
      "-vf",
      "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      videoPath,
    ]);

    log("ffmpeg: extract audio.mp3");
    await runCmd("ffmpeg", [
      "-loglevel", "error", "-y",
      "-i", videoPath,
      "-vn", "-acodec", "libmp3lame", "-b:a", "128k",
      audioPath,
    ]);

    log("ffmpeg: grab cover frame");
    await runCmd("ffmpeg", [
      "-loglevel", "error", "-y",
      "-ss", "00:00:01", "-i", videoPath,
      "-vframes", "1", "-q:v", "3",
      coverPath,
    ]).catch((err) => {
      log(`cover grab failed (non-fatal): ${err}`);
    });

    log("extract_choreo.py");
    await runCmd(
      "/opt/mp_env/bin/python",
      [
        "/app/extract_choreo.py",
        videoPath,
        choreoPath,
        "--every-nth",
        "2",
      ],
    );

    log("uploading outputs to Vercel Blob");
    const [videoBuf, audioBuf, choreoBuf] = await Promise.all([
      readFile(videoPath),
      readFile(audioPath),
      readFile(choreoPath),
    ]);
    const coverBuf = await readFile(coverPath).catch(() => null);

    const [videoBlob, audioBlob, choreoBlob, coverBlob] = await Promise.all([
      putBlob(`tracks/${trackId}/video.mp4`, videoBuf, "video/mp4"),
      putBlob(`tracks/${trackId}/audio.mp3`, audioBuf, "audio/mpeg"),
      putBlob(`tracks/${trackId}/choreo.json`, choreoBuf, "application/json"),
      coverBuf
        ? putBlob(`tracks/${trackId}/cover.jpg`, coverBuf, "image/jpeg")
        : Promise.resolve(null),
    ]);

    const choreoMeta = JSON.parse(choreoBuf.toString()) as {
      durationMs?: number;
      frameCount?: number;
    };

    await postCallback(callbackUrl, callbackSecret, {
      trackId,
      status: "ready",
      videoUrl: videoBlob.url,
      audioUrl: audioBlob.url,
      choreoUrl: choreoBlob.url,
      coverUrl: coverBlob?.url,
      durationMs: choreoMeta.durationMs,
      frames: choreoMeta.frameCount,
    });
    log("done");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ingest ${trackId}] failed`, msg);
    await postCallback(callbackUrl, callbackSecret, {
      trackId,
      status: "failed",
      error: msg.slice(0, 400),
    }).catch(() => {});
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function putBlob(
  pathname: string,
  data: Buffer,
  contentType: string,
): Promise<{ url: string; pathname: string }> {
  const result = await put(pathname, data, {
    access: "public",
    contentType,
    allowOverwrite: true,
    token: BLOB_TOKEN,
  });
  return { url: result.url, pathname: result.pathname };
}

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "inherit", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function postCallback(
  url: string,
  secret: string,
  body: CallbackBody,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": secret,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn(
      `[callback ${body.trackId}] ${res.status}: ${txt.slice(0, 200)}`,
    );
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

app.listen(PORT, () => {
  console.log(`vibecheque-worker listening on :${PORT}`);
});
