"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CalibrationGate } from "./components/CalibrationGate";
import { SunglassesGate } from "./components/SunglassesGate";

type Step = "sunglasses" | "calibration" | "entering";

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("sunglasses");
  const [gatePassed, setGatePassed] = useState(false);

  const handleStatusChange = useCallback((passed: boolean) => {
    setGatePassed(passed);
  }, []);

  // Sunglasses detected → advance to calibration
  useEffect(() => {
    if (step === "sunglasses" && gatePassed) {
      const id = setTimeout(() => setStep("calibration"), 500);
      return () => clearTimeout(id);
    }
  }, [step, gatePassed]);

  const onCalibrated = useCallback(() => {
    setTimeout(() => setStep("entering"), 400);
  }, []);

  // Once we're entering, schedule the route push
  useEffect(() => {
    if (step !== "entering") return;
    const id = setTimeout(() => router.push("/room"), 500);
    return () => clearTimeout(id);
  }, [step, router]);

  return (
    <>
      {step === "sunglasses" && (
        <SunglassesGate onStatusChange={handleStatusChange} />
      )}
      {step === "calibration" && <CalibrationGate onReady={onCalibrated} />}

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
          <div className="pointer-events-auto flex flex-col items-center gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300/80">
              step 1 · gate
            </p>
            <h2
              className={`font-mono text-3xl font-semibold uppercase leading-tight tracking-[0.18em] transition-all duration-500 md:text-5xl lg:text-6xl ${
                gatePassed
                  ? "scale-105 text-fuchsia-200 drop-shadow-[0_0_40px_rgba(255,77,240,0.8)]"
                  : "text-white drop-shadow-[0_2px_30px_rgba(0,0,0,0.85)]"
              }`}
            >
              {gatePassed ? "Sunglasses detected" : "Put on your sunglasses"}
            </h2>
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              stay close to the camera
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
