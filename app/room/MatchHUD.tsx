"use client";

import { useParticipants } from "@livekit/components-react";
import { useEffect, useState } from "react";
import { useSession } from "./SessionProvider";
import { StakePill } from "./StakePill";

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
    winnings,
    buyIn,
    startMatch,
    match,
    participants: lobbyCount,
    maxPlayers,
    lobbyLocked,
    meetMode,
    enterMeet,
    exitMeet,
  } = useSession();
  const participants = useParticipants();

  if (meetMode) {
    return <MeetScreen onLeave={exitMeet} />;
  }

  if (phase === "idle") {
    const ready = lobbyCount >= 2 && !lobbyLocked;
    const solo = lobbyCount <= 1;
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-end gap-4 pb-8">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-200 backdrop-blur">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              ready
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]"
                : "bg-zinc-400 animate-pulse"
            }`}
          />
          <span>
            {lobbyCount}/{maxPlayers} dancers
          </span>
          {lobbyLocked && <span className="text-fuchsia-300">· locked</span>}
        </div>

        {solo ? (
          <p className="pointer-events-auto rounded-full bg-black/60 px-5 py-2 font-mono text-xs uppercase tracking-widest text-zinc-300 backdrop-blur">
            waiting for a dance partner…
          </p>
        ) : lobbyLocked ? (
          <p className="pointer-events-auto rounded-full bg-fuchsia-500/20 px-5 py-2 font-mono text-xs uppercase tracking-widest text-fuchsia-200 backdrop-blur">
            starting…
          </p>
        ) : (
          <div className="pointer-events-auto flex flex-col items-center gap-2">
            <button
              onClick={() => startMatch()}
              disabled={!ready}
              className="rounded-full bg-fuchsia-500 px-8 py-4 text-sm font-semibold text-black shadow-[0_0_40px_rgba(255,77,240,0.5)] transition hover:bg-fuchsia-400 disabled:opacity-50"
            >
              ▶ Start now
            </button>
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              or wait — more can still join
            </p>
          </div>
        )}

        <StakePill />
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
    const pool = buyIn * participants.length;
    return (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center gap-2 px-4 pt-4">
        <div className="flex w-full max-w-xl items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2 font-mono text-xs uppercase tracking-widest text-white backdrop-blur">
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
        <div className="flex gap-2 font-mono text-[10px] uppercase tracking-widest">
          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-emerald-200">
            pot ${pool.toFixed(2)}
          </span>
          <span className="rounded-full border border-white/10 bg-black/60 px-3 py-1 text-zinc-300">
            streams live · Base Sepolia (sim)
          </span>
        </div>
      </div>
    );
  }

  // ended
  const allIdentities = new Set<string>([
    ...totals.keys(),
    ...winnings.keys(),
  ]);
  const ranked = [...allIdentities]
    .map((identity) => {
      const p = participants.find((x) => x.identity === identity);
      return {
        identity,
        name: p?.name || identity.slice(0, 10),
        isLocal: p?.isLocal ?? false,
        total: Math.round(totals.get(identity) ?? 0),
        net: winnings.get(identity) ?? 0,
      };
    })
    .sort((a, b) => b.net - a.net || b.total - a.total);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-white/10 bg-black/70 p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.4em] text-fuchsia-300">
          final
        </p>
        <h2 className="text-4xl font-semibold text-white">Settlement</h2>
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
                <span className="flex items-center gap-4">
                  <span className="tabular-nums text-xs text-zinc-500">
                    {row.total}
                  </span>
                  <span
                    className={`tabular-nums ${
                      row.net > 0
                        ? "text-emerald-300"
                        : row.net < 0
                          ? "text-rose-300"
                          : "text-zinc-400"
                    }`}
                  >
                    {row.net >= 0 ? "+" : "-"}${Math.abs(row.net).toFixed(2)}
                  </span>
                </span>
              </li>
            ))
          )}
        </ol>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          stakes settle bottom half → top half · ${buyIn.toFixed(2)} buy-in
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => startMatch()}
            className="rounded-full bg-fuchsia-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-fuchsia-400"
          >
            Dance again
          </button>
          <button
            onClick={() => enterMeet()}
            className="rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
          >
            Meet one another →
          </button>
        </div>
      </div>
    </div>
  );
}

// Post-match chill room: music off, game overlays off, voice still live
// via LiveKit audio. Prompts the user to take off their sunglasses so the
// conversation feels real.
function MeetScreen({ onLeave }: { onLeave: () => void }) {
  const [showPrompt, setShowPrompt] = useState(true);
  // Fade the "take off your sunglasses" prompt after a few seconds so
  // it doesn't hog the screen while people are actually chatting.
  useEffect(() => {
    const id = setTimeout(() => setShowPrompt(false), 6000);
    return () => clearTimeout(id);
  }, []);

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center gap-2 px-4 pt-6">
        <div
          className={`flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-200 backdrop-blur transition-opacity duration-700 ${
            showPrompt ? "opacity-100" : "opacity-50"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
          <span>voice live · music off</span>
        </div>
        {showPrompt && (
          <h2 className="mt-2 rounded-2xl bg-black/50 px-6 py-3 text-center font-mono text-2xl font-semibold uppercase tracking-[0.18em] text-white drop-shadow-[0_2px_30px_rgba(0,0,0,0.85)] backdrop-blur md:text-3xl">
            Take off your sunglasses
          </h2>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center">
        <button
          onClick={onLeave}
          className="pointer-events-auto rounded-full border border-white/20 bg-black/60 px-5 py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-300 backdrop-blur hover:text-white"
        >
          ← back to dance floor
        </button>
      </div>
    </>
  );
}
