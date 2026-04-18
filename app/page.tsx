"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SunglassesGate } from "./components/SunglassesGate";

export default function Home() {
  const router = useRouter();
  const [gatePassed, setGatePassed] = useState(false);

  const handleStatusChange = useCallback((passed: boolean) => {
    setGatePassed(passed);
  }, []);

  // Sunglasses detected → go straight to the room as a guest. Wallet
  // sign-in lives in the lobby for players who want money play.
  useEffect(() => {
    if (!gatePassed) return;
    const id = setTimeout(() => router.push("/room"), 600);
    return () => clearTimeout(id);
  }, [gatePassed, router]);

  const statusLine = gatePassed ? "entering the floor…" : null;

  return (
    <>
      <SunglassesGate onStatusChange={handleStatusChange} />

      <main className="pointer-events-none relative z-20 flex flex-1 flex-col items-center justify-between px-6 py-14 text-center">
        <div className="pointer-events-auto flex flex-col items-center gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-fuchsia-300/80">
            ETHSilesia · 2026
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)] md:text-4xl">
            Vibe<span className="text-fuchsia-400">Cheque</span>
          </h1>
        </div>

        <div className="pointer-events-auto flex flex-col items-center gap-6">
          <h2
            className={`font-mono text-3xl font-semibold uppercase leading-tight tracking-[0.18em] transition-all duration-500 md:text-5xl lg:text-6xl ${
              gatePassed
                ? "scale-105 text-fuchsia-200 drop-shadow-[0_0_40px_rgba(255,77,240,0.8)]"
                : "text-white drop-shadow-[0_2px_30px_rgba(0,0,0,0.85)]"
            }`}
          >
            {gatePassed ? "Sunglasses detected" : "Put on your sunglasses"}
          </h2>
          <div className="h-6">
            {statusLine && (
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-fuchsia-200/90 animate-pulse">
                {statusLine}
              </p>
            )}
          </div>
        </div>

        <div className="h-6" />
      </main>
    </>
  );
}
