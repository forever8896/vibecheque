"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CalibrationGate } from "./components/CalibrationGate";
import { SunglassesGate } from "./components/SunglassesGate";

type Step = "calibration" | "sunglasses" | "entering";

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("calibration");
  const [gatePassed, setGatePassed] = useState(false);

  const handleStatusChange = useCallback((passed: boolean) => {
    setGatePassed(passed);
  }, []);

  const onCalibrated = useCallback(() => {
    // Delay step transition slightly so "Calibrated" flashes on screen
    setTimeout(() => setStep("sunglasses"), 600);
  }, []);

  // Sunglasses detected → guest mode, off to /room
  useEffect(() => {
    if (step !== "sunglasses" || !gatePassed) return;
    setStep("entering");
    const id = setTimeout(() => router.push("/room"), 600);
    return () => clearTimeout(id);
  }, [step, gatePassed, router]);

  return (
    <>
      {step === "calibration" && <CalibrationGate onReady={onCalibrated} />}
      {(step === "sunglasses" || step === "entering") && (
        <SunglassesGate onStatusChange={handleStatusChange} />
      )}

      <main className="pointer-events-none relative z-20 flex flex-1 flex-col items-center justify-between px-6 py-14 text-center">
        <div className="pointer-events-auto flex flex-col items-center gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-fuchsia-300/80">
            ETHSilesia · 2026
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)] md:text-4xl">
            Vibe<span className="text-fuchsia-400">Cheque</span>
          </h1>
        </div>

        {step === "sunglasses" && (
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
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300/80">
              step 2 · gate
            </p>
          </div>
        )}

        {step === "entering" && (
          <p className="pointer-events-auto font-mono text-xs uppercase tracking-[0.3em] text-fuchsia-200/90 animate-pulse">
            entering the floor…
          </p>
        )}

        <div className="h-6" />
      </main>
    </>
  );
}
