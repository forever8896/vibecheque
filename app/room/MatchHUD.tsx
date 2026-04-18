"use client";

import { useParticipants } from "@livekit/components-react";
import { useSession } from "./SessionProvider";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function MatchHUD() {
  const {
    phase,
    secondsToStart,
    secondsElapsed,
    secondsRemaining,
    progress,
    totals,
    startMatch,
    match,
  } = useSession();
  const participants = useParticipants();

  if (phase === "idle") {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center pb-8">
        <button
          onClick={() => startMatch()}
          className="pointer-events-auto rounded-full bg-fuchsia-500 px-8 py-4 text-sm font-semibold text-black shadow-[0_0_40px_rgba(255,77,240,0.5)] transition hover:bg-fuchsia-400"
        >
          ▶ Start a match
        </button>
      </div>
    );
  }

  if (phase === "countdown") {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/40 backdrop-blur-sm">
        <p className="font-mono text-xs uppercase tracking-[0.4em] text-fuchsia-300">
          get ready
        </p>
        <p className="text-[14rem] font-semibold leading-none text-white drop-shadow-[0_0_60px_rgba(255,77,240,0.6)]">
          {secondsToStart || "GO"}
        </p>
      </div>
    );
  }

  if (phase === "playing") {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-4">
        <div className="mx-auto flex max-w-xl items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2 font-mono text-xs uppercase tracking-widest text-white backdrop-blur">
          <span className="text-fuchsia-300">● live</span>
          <span className="tabular-nums">
            {formatTime(secondsElapsed)} /{" "}
            {formatTime((match?.duration ?? 0) / 1000)}
          </span>
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 bg-fuchsia-400"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
          <span className="tabular-nums text-zinc-400">
            -{formatTime(secondsRemaining)}
          </span>
        </div>
      </div>
    );
  }

  // ended
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([identity, total]) => {
      const p = participants.find((x) => x.identity === identity);
      return {
        identity,
        name: p?.name || identity.slice(0, 10),
        isLocal: p?.isLocal ?? false,
        total: Math.round(total),
      };
    });

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-white/10 bg-black/70 p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.4em] text-fuchsia-300">
          final
        </p>
        <h2 className="text-4xl font-semibold text-white">Leaderboard</h2>
        <ol className="flex w-full flex-col gap-2">
          {ranked.length === 0 ? (
            <li className="font-mono text-xs text-zinc-500">
              no scores captured
            </li>
          ) : (
            ranked.map((row, i) => (
              <li
                key={row.identity}
                className={`flex items-center justify-between rounded-xl px-4 py-2 font-mono text-sm ${
                  i === 0
                    ? "bg-fuchsia-500/20 text-white"
                    : "bg-white/5 text-zinc-300"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="w-6 text-left tabular-nums opacity-60">
                    #{i + 1}
                  </span>
                  <span className={row.isLocal ? "text-fuchsia-300" : ""}>
                    {row.name}
                    {row.isLocal ? " (you)" : ""}
                  </span>
                </span>
                <span className="tabular-nums">{row.total}</span>
              </li>
            ))
          )}
        </ol>
        <div className="flex gap-3">
          <button
            onClick={() => startMatch()}
            className="rounded-full bg-fuchsia-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-fuchsia-400"
          >
            Dance again
          </button>
        </div>
      </div>
    </div>
  );
}
