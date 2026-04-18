"use client";

import { useEffect, useRef } from "react";

// Shared mutable beat state, updated by useAudioBeats and read by any
// component that wants to react to the song's rhythm (screen pulse,
// rhythm scoring, etc.). Kept as a plain module object so writes at
// 60 Hz don't thrash React.
export const beatState = {
  intensity: 0, // 0-1 instantaneous bass energy
  lastFlashAt: 0, // performance.now() when the most recent beat was detected
  bpm: 0, // estimated BPM from recent beat intervals
  isActive: false, // flipped true once we've detected at least one beat
};

const recentBeats: number[] = [];

function recordBeat(now: number) {
  beatState.lastFlashAt = now;
  beatState.isActive = true;
  recentBeats.push(now);
  // Keep ~30 seconds of beat history
  while (recentBeats.length > 0 && now - recentBeats[0] > 30_000) {
    recentBeats.shift();
  }
  if (recentBeats.length >= 4) {
    const intervals: number[] = [];
    for (let i = 1; i < recentBeats.length; i++) {
      intervals.push(recentBeats[i] - recentBeats[i - 1]);
    }
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    if (median > 0) beatState.bpm = Math.round(60000 / median);
  }
}

export function getRecentBeats(now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return recentBeats.filter((t) => t >= cutoff);
}

// Hook into an <audio> element: creates an AudioContext + AnalyserNode
// the first time the audio is ready, keeps the playback going through
// the destination, and runs a rAF loop that writes to beatState.
export function useAudioBeats(audio: HTMLAudioElement | null) {
  const doneRef = useRef(false);

  useEffect(() => {
    if (!audio) return;
    if (doneRef.current) return;

    let audioCtx: AudioContext | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let rafId = 0;
    let cancelled = false;
    let attached = false;

    function setup() {
      if (attached || cancelled) return;
      try {
        type AudioContextCtor = typeof AudioContext;
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: AudioContextCtor })
            .webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
        source = audioCtx.createMediaElementSource(audio!);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.18;
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        attached = true;
        doneRef.current = true;

        const bins = analyser.frequencyBinCount;
        const freqData = new Uint8Array(bins);
        const recentEnergy: number[] = [];
        const RECENT_WINDOW = 60; // ~1 second at 60fps
        const BASS_END = 10; // first 10 bins ≈ 0-430 Hz at 44.1kHz / 1024 fft
        const BEAT_THRESHOLD_RATIO = 1.35;
        const BEAT_MIN_ENERGY = 0.22;
        const BEAT_MIN_INTERVAL = 240; // ms, ~250 BPM max

        let lastBeatTs = 0;

        function loop() {
          if (cancelled || !analyser) return;
          rafId = requestAnimationFrame(loop);

          analyser.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 1; i <= BASS_END; i++) sum += freqData[i];
          const energy = sum / BASS_END / 255;
          beatState.intensity = energy;

          recentEnergy.push(energy);
          if (recentEnergy.length > RECENT_WINDOW) recentEnergy.shift();
          const avg =
            recentEnergy.reduce((s, e) => s + e, 0) / recentEnergy.length;

          const now = performance.now();
          if (
            energy > avg * BEAT_THRESHOLD_RATIO &&
            energy > BEAT_MIN_ENERGY &&
            now - lastBeatTs > BEAT_MIN_INTERVAL
          ) {
            lastBeatTs = now;
            recordBeat(now);
          }
        }
        loop();
      } catch (err) {
        console.warn("[beats] setup failed", err);
      }
    }

    // AudioContext needs a user gesture — SyncedMusic's play() is that
    // gesture. Wait for a 'playing' event to be safe.
    if (audio.readyState >= 2 && !audio.paused) {
      setup();
    } else {
      const onPlaying = () => {
        audio.removeEventListener("playing", onPlaying);
        setup();
      };
      audio.addEventListener("playing", onPlaying);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      try {
        analyser?.disconnect();
      } catch {
        /* noop */
      }
      try {
        source?.disconnect();
      } catch {
        /* noop */
      }
      try {
        audioCtx?.close();
      } catch {
        /* noop */
      }
    };
  }, [audio]);
}
