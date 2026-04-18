"use client";

import { useState } from "react";
import { useSession } from "./SessionProvider";
import { useTracks, type TrackSummary } from "./useTracks";

function fmtDuration(ms?: number): string {
  if (!ms || ms < 1000) return "—";
  const secs = Math.round(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function TrackSelector() {
  const { selectedTrackId, selectTrack, lobbyLocked } = useSession();
  const { tracks, ready } = useTracks();
  const [open, setOpen] = useState(false);

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
      <button
        disabled={lobbyLocked}
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/15 bg-black/70 px-4 py-2 text-left font-mono backdrop-blur transition hover:border-white/30 disabled:opacity-50"
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
                      src={`/tracks/${t.id}/cover.jpg`}
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
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              add more · scripts/ingest-track.sh &lt;url&gt;
            </p>
          </div>
        </div>
      )}
    </>
  );
}
