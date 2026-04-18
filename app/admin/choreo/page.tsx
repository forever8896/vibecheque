"use client";

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

type Frame = {
  t: number; // ms into the source video
  lm: Array<{ x: number; y: number; v: number }>;
};

type Choreo = {
  source: string;
  videoWidth: number;
  videoHeight: number;
  durationMs: number;
  frameCount: number;
  avgFps: number;
  extractedAt: string;
  frames: Frame[];
};

// MediaPipe skeleton connections used for the preview
const CONN: [number, number][] = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 32],
  [0, 11],
  [0, 12],
];

export default function ChoreoExtractor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("drop a video to begin");
  const [progress, setProgress] = useState(0);
  const [choreo, setChoreo] = useState<Choreo | null>(null);
  const [extracting, setExtracting] = useState(false);

  // --- extraction ---------------------------------------------------------

  const run = useCallback(async () => {
    if (!file || !videoRef.current) return;
    const video = videoRef.current;
    setExtracting(true);
    setChoreo(null);
    setProgress(0);

    setStatus("loading pose model…");
    const resolver = await FilesetResolver.forVisionTasks(WASM_BASE);
    const landmarker = await PoseLandmarker.createFromOptions(resolver, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
    });

    setStatus("loading video…");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    // 2× playback so extraction is quicker than real-time. rVFC fires per
    // decoded source frame regardless of playbackRate, so we don't drop data.
    video.playbackRate = 2.0;
    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      const onReady = () => {
        video.removeEventListener("loadeddata", onReady);
        resolve();
      };
      video.addEventListener("loadeddata", onReady);
    });

    const duration = video.duration * 1000;
    const frames: Frame[] = [];
    let lastTs = -1;

    setStatus("extracting pose per frame…");

    // requestVideoFrameCallback gives us a precise media-time per decoded
    // frame, which is the truthful source timestamp we want.
    type VFCMeta = { mediaTime: number };
    type VFCCallback = (now: number, metadata: VFCMeta) => void;
    type VideoWithVFC = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: VFCCallback) => number;
    };

    await new Promise<void>((resolve) => {
      const onDone = () => {
        video.removeEventListener("ended", onDone);
        resolve();
      };
      video.addEventListener("ended", onDone);

      const onFrame: VFCCallback = (_now, meta) => {
        const tMs = meta.mediaTime * 1000;
        if (tMs <= lastTs) {
          (video as VideoWithVFC).requestVideoFrameCallback?.(onFrame);
          return;
        }
        lastTs = tMs;
        try {
          const r = landmarker.detectForVideo(video, tMs);
          const lm = r.landmarks?.[0] as NormalizedLandmark[] | undefined;
          if (lm) {
            frames.push({
              t: Math.round(tMs),
              lm: lm.map((p) => ({
                x: +p.x.toFixed(4),
                y: +p.y.toFixed(4),
                v: +(p.visibility ?? 0).toFixed(2),
              })),
            });
          }
        } catch {
          /* skip */
        }
        setProgress(duration > 0 ? Math.min(1, tMs / duration) : 0);
        (video as VideoWithVFC).requestVideoFrameCallback?.(onFrame);
      };

      (video as VideoWithVFC).requestVideoFrameCallback?.(onFrame);
      video.play().catch(() => {
        /* autoplay blocked — user needs to click */
      });
    });

    landmarker.close();
    URL.revokeObjectURL(url);

    const durationActual =
      frames.length > 0 ? frames[frames.length - 1].t : duration;
    const avgFps =
      durationActual > 0 ? (frames.length * 1000) / durationActual : 0;

    const result: Choreo = {
      source: file.name,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      durationMs: Math.round(durationActual),
      frameCount: frames.length,
      avgFps: +avgFps.toFixed(2),
      extractedAt: new Date().toISOString(),
      frames,
    };
    setChoreo(result);
    setStatus(
      `done · ${frames.length} frames · ${avgFps.toFixed(1)} fps · ${(durationActual / 1000).toFixed(1)} s`,
    );
    setProgress(1);
    setExtracting(false);
  }, [file]);

  // --- preview playback ---------------------------------------------------

  useEffect(() => {
    if (!choreo || !previewRef.current) return;
    const canvas = previewRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 320;
    canvas.height = 320;

    let raf = 0;
    let cancelled = false;
    const startAt = performance.now();

    function draw() {
      if (cancelled) return;
      raf = requestAnimationFrame(draw);
      if (!ctx || !canvas || !choreo) return;
      const elapsed = (performance.now() - startAt) % choreo.durationMs;
      // Find nearest frame (binary search could be nice, linear is fine)
      let idx = 0;
      for (let i = 0; i < choreo.frames.length; i++) {
        if (choreo.frames[i].t <= elapsed) idx = i;
        else break;
      }
      const f = choreo.frames[idx];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!f) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.strokeStyle = "rgba(255,77,240,0.9)";
      ctx.fillStyle = "rgba(255,77,240,0.9)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      for (const [a, b] of CONN) {
        const pa = f.lm[a];
        const pb = f.lm[b];
        if (!pa || !pb) continue;
        if (pa.v < 0.3 || pb.v < 0.3) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x * w, pa.y * h);
        ctx.lineTo(pb.x * w, pb.y * h);
        ctx.stroke();
      }
      for (let i = 11; i <= 32; i++) {
        const p = f.lm[i];
        if (!p || p.v < 0.3) continue;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    draw();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [choreo]);

  // --- download -----------------------------------------------------------

  const downloadJson = useCallback(() => {
    if (!choreo) return;
    const blob = new Blob([JSON.stringify(choreo)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "choreo.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [choreo]);

  // --- UI -----------------------------------------------------------------

  return (
    <main className="min-h-screen bg-black p-8 text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300/80">
            VibeCheque · tools
          </p>
          <h1 className="text-3xl font-semibold">Choreography extractor</h1>
          <p className="text-sm text-zinc-400">
            Drop a dance video. We run MediaPipe Pose on every decoded frame
            and hand you a JSON of landmarks over time. Place the result at{" "}
            <code className="rounded bg-white/5 px-1 py-0.5 text-fuchsia-200">
              public/choreo.json
            </code>{" "}
            to plug it into the match scorer.
          </p>
        </header>

        <div className="rounded-xl border border-white/10 bg-black/60 p-6">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 bg-white/5 p-8 hover:bg-white/10">
            <span className="font-mono text-xs uppercase tracking-widest text-zinc-400">
              drop or pick a .mp4 / .webm
            </span>
            <span className="text-sm">
              {file ? file.name : "no file selected"}
            </span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => void run()}
              disabled={!file || extracting}
              className="rounded-full bg-fuchsia-500 px-6 py-2 text-sm font-semibold text-black transition hover:bg-fuchsia-400 disabled:opacity-40"
            >
              {extracting ? "extracting…" : "extract"}
            </button>
            {choreo && (
              <button
                onClick={downloadJson}
                className="rounded-full border border-white/20 bg-white/5 px-6 py-2 text-sm hover:bg-white/10"
              >
                download choreo.json
              </button>
            )}
            <span className="ml-auto font-mono text-xs text-zinc-400">
              {status}
            </span>
          </div>

          <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-fuchsia-400 transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>

          {/* Keep the video element alive but hidden; the extractor uses it */}
          <video
            ref={videoRef}
            className="hidden"
            muted
            playsInline
            preload="auto"
          />
        </div>

        {choreo && (
          <div className="rounded-xl border border-white/10 bg-black/60 p-6">
            <div className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-4">
              <canvas
                ref={previewRef}
                className="rounded-xl border border-white/10 bg-black"
              />
              <div className="space-y-1 font-mono text-xs text-zinc-300">
                <div>
                  <span className="text-zinc-500">source</span>{" "}
                  <span>{choreo.source}</span>
                </div>
                <div>
                  <span className="text-zinc-500">frames</span>{" "}
                  <span>{choreo.frameCount}</span>
                </div>
                <div>
                  <span className="text-zinc-500">fps</span>{" "}
                  <span>{choreo.avgFps}</span>
                </div>
                <div>
                  <span className="text-zinc-500">duration</span>{" "}
                  <span>{(choreo.durationMs / 1000).toFixed(2)}s</span>
                </div>
                <div>
                  <span className="text-zinc-500">video</span>{" "}
                  <span>
                    {choreo.videoWidth}×{choreo.videoHeight}
                  </span>
                </div>
                <p className="mt-4 max-w-sm text-zinc-500">
                  The pink stick figure on the left is the extracted
                  choreography replaying on loop. If it looks like the dancer
                  you dropped in, we're good to wire it into the match
                  scorer.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
