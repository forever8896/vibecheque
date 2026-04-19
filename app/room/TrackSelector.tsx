"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "./SessionProvider";
import { useTracks, type TrackSummary } from "./useTracks";
import { ArmPointDetector, type ArmDirection } from "./armPointGesture";

function fmtDuration(ms?: number): string {
  if (!ms || ms < 1000) return "—";
  const secs = Math.round(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

type PointGestureState = {
  holding: { dir: ArmDirection; progress: number } | null;
  flash: ArmDirection | null;
};

function usePointGestureTrackChange(
  tracks: TrackSummary[],
  selectedTrackId: string | null,
  selectTrack: (id: string) => Promise<boolean>,
  enabled: boolean,
): PointGestureState {
  const { localFrameRef } = useSession();
  const [state, setState] = useState<PointGestureState>({
    holding: null,
    flash: null,
  });
  const tracksRef = useRef(tracks);
  const selectedIdRef = useRef(selectedTrackId);
  const selectRef = useRef(selectTrack);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);
  useEffect(() => {
    selectedIdRef.current = selectedTrackId;
  }, [selectedTrackId]);
  useEffect(() => {
    selectRef.current = selectTrack;
  }, [selectTrack]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    const detector = new ArmPointDetector();
    let raf = 0;
    let cancelled = false;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    let lastProgress = -1;
    let lastDir: ArmDirection | null = null;
    let lastFlash: ArmDirection | null = null;

    function loop() {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      if (!enabledRef.current) {
        detector.reset();
        if (lastDir !== null || lastProgress !== 0 || lastFlash !== null) {
          lastDir = null;
          lastProgress = 0;
          lastFlash = null;
          setState({ holding: null, flash: null });
        }
        return;
      }
      const f = localFrameRef.current;
      detector.observe(f?.landmarks ?? null, now);

      const fired = detector.consume(now);
      if (fired) {
        const ts = tracksRef.current;
        if (ts.length > 0) {
          // Extended right (body frame) → next, extended left → previous.
          let idx = ts.findIndex((t) => t.id === selectedIdRef.current);
          if (idx < 0) idx = 0;
          const delta = fired === "right" ? 1 : -1;
          const next = ts[(idx + delta + ts.length) % ts.length];
          void selectRef.current(next.id);
        }
        lastFlash = fired;
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
          lastFlash = null;
          setState((s) => ({ ...s, flash: null }));
        }, 550);
      }

      const prog = detector.progress(now);
      const dir = prog?.dir ?? null;
      // Quantize progress to 5% steps to avoid re-renders on every rAF.
      const quant = prog ? Math.round(prog.value * 20) / 20 : 0;
      if (dir !== lastDir || quant !== lastProgress || fired) {
        lastDir = dir;
        lastProgress = quant;
        setState({
          holding: dir ? { dir, progress: quant } : null,
          flash: lastFlash,
        });
      }
    }
    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (flashTimer) clearTimeout(flashTimer);
    };
  }, [localFrameRef]);

  return state;
}

export function TrackSelector() {
  const { selectedTrackId, selectTrack, lobbyLocked, phase } = useSession();
  const { tracks, ready, refetch } = useTracks();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadElapsed, setUploadElapsed] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!uploading) return;
    const started = performance.now();
    const id = setInterval(() => {
      setUploadElapsed(Math.floor((performance.now() - started) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [uploading]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-picking the same file still fires
    if (!file) return;

    const defaultTitle = file.name.replace(/\.[^.]+$/, "");
    const title = window.prompt("Name this dance", defaultTitle);
    if (title == null) return;
    const clean = title.trim();
    if (!clean) return;

    setUploadElapsed(0);
    setUploadError(null);
    setUploading(true);
    try {
      const cfg = await fetch("/api/config", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ cloudUploads: false }));
      const trackId = cfg.cloudUploads
        ? await uploadCloud(file, clean)
        : await uploadLocal(file, clean);
      refetch();
      await new Promise((r) => setTimeout(r, 300));
      const ok = await selectTrack(trackId);
      if (ok) setOpen(false);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function uploadLocal(file: File, title: string): Promise<string> {
    const form = new FormData();
    form.append("video", file);
    form.append("title", title);
    const res = await fetch("/api/track-upload", {
      method: "POST",
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      trackId?: string;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.trackId) {
      throw new Error(data.error || `upload failed (${res.status})`);
    }
    return data.trackId;
  }

  async function uploadCloud(file: File, title: string): Promise<string> {
    const { upload } = await import("@vercel/blob/client");
    const trackId = cryptoRandomId();
    const pathname = `uploads/${trackId}.mp4`;
    await upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/track-upload-cloud",
      clientPayload: JSON.stringify({ trackId, title }),
    });
    // onUploadCompleted fires on Vercel asynchronously — poll the store
    // until the worker flips status to "ready" (or "failed").
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch("/api/tracks", { cache: "no-store" });
      const data = (await res.json().catch(() => ({ tracks: [] }))) as {
        tracks: TrackSummary[];
      };
      const match = data.tracks.find((t) => t.id === trackId);
      if (match?.status === "ready") return trackId;
      if (match?.status === "failed") {
        throw new Error(match.error || "ingest failed");
      }
    }
    throw new Error("processing timed out");
  }

  const gestureEnabled = phase === "idle" && !lobbyLocked && !open;
  const gesture = usePointGestureTrackChange(
    tracks,
    selectedTrackId,
    selectTrack,
    gestureEnabled,
  );

  const current =
    tracks.find((t) => t.id === selectedTrackId) ??
    (selectedTrackId
      ? ({
          id: selectedTrackId,
          title: selectedTrackId,
        } as TrackSummary)
      : null);

  if (!ready && !current) return null;

  return (
    <>
      <div className="pointer-events-none relative flex items-center gap-3">
        <PointArrow
          direction="left"
          progress={
            gesture.holding?.dir === "left" ? gesture.holding.progress : 0
          }
          flash={gesture.flash === "left"}
        />
        <button
          disabled={lobbyLocked}
          onClick={() => setOpen(true)}
          className={`pointer-events-auto flex items-center gap-3 rounded-2xl border bg-black/70 px-4 py-2 text-left font-mono backdrop-blur transition disabled:opacity-50 ${
            gesture.flash
              ? "border-fuchsia-400 shadow-[0_0_20px_rgba(255,77,240,0.5)]"
              : "border-white/15 hover:border-white/30"
          }`}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-fuchsia-400/50 bg-fuchsia-500/20 text-fuchsia-200">
            ♫
          </span>
          <span className="flex flex-col">
            <span className="text-[9px] uppercase tracking-[0.3em] text-fuchsia-300">
              track · {tracks.length || "loading"}
            </span>
            <span className="max-w-[230px] truncate text-sm text-white">
              {current?.title || "pick a dance"}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-zinc-400">
              {fmtDuration(current?.durationMs)}
              {current?.uploader ? ` · ${current.uploader}` : ""}
            </span>
          </span>
        </button>
        <PointArrow
          direction="right"
          progress={
            gesture.holding?.dir === "right" ? gesture.holding.progress : 0
          }
          flash={gesture.flash === "right"}
        />
      </div>
      {gestureEnabled && tracks.length > 1 && (
        <p className="pointer-events-none mt-1 font-mono text-[9px] uppercase tracking-[0.3em] text-zinc-500">
          extend arm → next · extend arm ← previous
        </p>
      )}

      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
          <div className="relative flex max-h-[80vh] w-full max-w-3xl flex-col gap-4 rounded-3xl border border-white/10 bg-black/90 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300">
                  pick your dance
                </p>
                <h2 className="text-2xl font-semibold text-white">
                  Track library
                </h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/20 bg-white/5 px-4 py-1.5 font-mono text-xs uppercase tracking-widest text-white hover:bg-white/10"
              >
                close
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-3 overflow-auto md:grid-cols-2">
              {tracks.length === 0 && (
                <p className="col-span-full text-center font-mono text-xs text-zinc-500">
                  no tracks ingested yet · run scripts/ingest-track.sh
                </p>
              )}
              {tracks.map((t) => {
                const active = t.id === selectedTrackId;
                return (
                  <button
                    key={t.id}
                    onClick={async () => {
                      const ok = await selectTrack(t.id);
                      if (ok) setOpen(false);
                    }}
                    className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition ${
                      active
                        ? "border-fuchsia-400 bg-fuchsia-500/15"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <img
                      src={t.coverUrl || ""}
                      alt=""
                      className="h-16 w-16 flex-shrink-0 rounded-lg border border-white/10 bg-black object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility =
                          "hidden";
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-white">
                        {t.title}
                      </p>
                      <p className="truncate font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                        {t.uploader || "—"} · {fmtDuration(t.durationMs)}
                      </p>
                      {active && (
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-fuchsia-300">
                          selected ✓
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-full border border-fuchsia-400/60 bg-fuchsia-500/20 px-4 py-1.5 font-mono text-[11px] uppercase tracking-widest text-fuchsia-100 transition hover:bg-fuchsia-500/30 disabled:opacity-60"
              >
                {uploading
                  ? `processing… ${uploadElapsed}s`
                  : "+ upload your dance"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleUpload}
              />
              {uploadError ? (
                <span className="font-mono text-[10px] text-rose-300">
                  {uploadError}
                </span>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  mp4 · we extract audio + pose skeleton (~30s)
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  // fallback for the rare no-crypto browser
  return Math.random().toString(16).slice(2, 18);
}

function PointArrow({
  direction,
  progress,
  flash,
}: {
  direction: "left" | "right";
  progress: number;
  flash: boolean;
}) {
  // While the player holds their arm out, the chevron lights up
  // progressively (alpha + glow), then briefly flashes on commit.
  const held = progress > 0;
  const alpha = flash ? 1 : Math.max(0.3, Math.min(1, 0.3 + progress * 0.7));
  const scale = flash ? 1.35 : 1 + progress * 0.25;
  const glow = flash
    ? "0 0 14px rgba(255, 77, 240, 0.9)"
    : held
      ? `0 0 ${Math.round(8 + progress * 10)}px rgba(34, 211, 238, ${
          0.4 + progress * 0.5
        })`
      : "none";
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center font-mono text-xl transition-[color,transform] duration-150"
      style={{
        color: flash
          ? `rgba(255, 77, 240, ${alpha})`
          : `rgba(34, 211, 238, ${alpha})`,
        transform: `scale(${scale})`,
        textShadow: glow,
      }}
    >
      {direction === "left" ? "‹" : "›"}
    </span>
  );
}
