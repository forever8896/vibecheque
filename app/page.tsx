"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useState } from "react";
import { SunglassesGate } from "./components/SunglassesGate";

export default function Home() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const [gatePassed, setGatePassed] = useState(false);
  const handleStatusChange = useCallback((passed: boolean) => {
    setGatePassed(passed);
  }, []);

  return (
    <>
      <SunglassesGate onStatusChange={handleStatusChange} />

      <main className="pointer-events-none relative z-20 flex flex-1 flex-col items-center justify-between px-6 py-16 text-center">
        <div className="pointer-events-auto flex flex-col items-center gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.4em] text-fuchsia-300/80">
            ETHSilesia · 2026
          </p>
          <h1 className="text-6xl font-semibold tracking-tight text-white drop-shadow-[0_2px_40px_rgba(0,0,0,0.9)] md:text-8xl">
            Vibe<span className="text-fuchsia-400">Cheque</span>
          </h1>
          <p className="max-w-md text-sm text-zinc-300 drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)] md:text-base">
            A dancing game you can only win with your actual body. Sunglasses
            on. Money streams from the worst dancers to the best while the song
            plays.
          </p>
        </div>

        <div className="pointer-events-auto flex min-h-[8rem] flex-col items-center justify-end gap-3">
          {!gatePassed ? (
            <p className="max-w-xs rounded-full bg-black/50 px-5 py-2 font-mono text-xs uppercase tracking-widest text-zinc-200 backdrop-blur">
              put on your sunglasses to enter
            </p>
          ) : !ready ? (
            <div className="h-12 w-48 animate-pulse rounded-full bg-white/5" />
          ) : authenticated ? (
            <div className="flex flex-col items-center gap-3">
              <Link
                href="/room"
                className="rounded-full bg-fuchsia-500 px-10 py-4 text-base font-semibold text-black shadow-[0_0_40px_rgba(255,77,240,0.5)] transition hover:bg-fuchsia-400"
              >
                Enter the floor →
              </Link>
              <button
                onClick={() => logout()}
                className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 underline hover:text-zinc-200"
              >
                sign out · {user?.wallet?.address?.slice(0, 8) ?? "guest"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => login()}
              className="rounded-full border border-white/30 bg-white/10 px-10 py-4 text-base font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              Sign in to continue
            </button>
          )}
        </div>
      </main>
    </>
  );
}
