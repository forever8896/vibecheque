"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";

export default function Home() {
  const { ready, authenticated, login, logout, user } = usePrivy();

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-black px-6 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,77,240,0.18),transparent_60%)]" />
      <div className="relative z-10 flex flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.4em] text-fuchsia-300/80">
            ETHSilesia · 2026
          </p>
          <h1 className="text-6xl font-semibold tracking-tight text-white md:text-8xl">
            Vibe<span className="text-fuchsia-400">Cheque</span>
          </h1>
          <p className="max-w-md text-sm text-zinc-400 md:text-base">
            A dancing game you can only win with your actual body. Put on your
            sunglasses. Dance. Money streams from the worst dancers to the best
            while the song plays.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
            Put on your sunglasses to enter
          </p>

          {!ready ? (
            <div className="h-12 w-48 animate-pulse rounded-full bg-white/5" />
          ) : authenticated ? (
            <div className="flex flex-col items-center gap-3">
              <Link
                href="/room"
                className="rounded-full bg-fuchsia-500 px-8 py-3 text-sm font-semibold text-black transition hover:bg-fuchsia-400"
              >
                Enter the floor →
              </Link>
              <button
                onClick={() => logout()}
                className="text-xs text-zinc-500 underline"
              >
                sign out · {user?.wallet?.address?.slice(0, 8) ?? "guest"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => login()}
              className="rounded-full border border-white/20 bg-white/5 px-8 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Sign in with wallet
            </button>
          )}

          <Link
            href="/room"
            className="mt-2 font-mono text-[10px] uppercase tracking-widest text-zinc-600 hover:text-zinc-400"
          >
            dev · skip to room
          </Link>
        </div>
      </div>

      <footer className="absolute bottom-4 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-widest text-zinc-600">
        made during ETHSilesia 2026
      </footer>
    </main>
  );
}
