"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSession } from "./SessionProvider";
import { useOnChain, useStakeActions } from "@/app/chain/useOnChain";
import { BUY_IN_WEI, onChainReady } from "@/app/chain/config";

function fmtVUSD(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const frac = (micros % 1_000_000n) / 10_000n; // 4 decimals -> 2
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

// Pill rendered inside the lobby HUD (idle phase). Shows on-chain balance
// and the stake-to-play flow. Opt-in — skipping makes it a free-play match.
export function StakePill() {
  const { nextMatchId, activeMatchId, phase } = useSession();
  const { authenticated, login, ready: privyReady } = usePrivy();
  const chain = useOnChain({ nextMatchId, activeMatchId });
  const actions = useStakeActions({ refresh: chain.refresh });

  if (!onChainReady()) return null;

  // Guest player — offer an optional sign-in to unlock money play
  if (privyReady && !authenticated) {
    return (
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <button
          onClick={() => login()}
          className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-5 py-2 font-mono text-[11px] uppercase tracking-widest text-fuchsia-200 transition hover:bg-fuchsia-500/25"
        >
          Sign in for money play
        </button>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          optional · guest free play is on
        </p>
      </div>
    );
  }

  const { address, balance, hasClaimed, stakedInNext } = chain;
  const staked = stakedInNext > 0n;
  const inMatch = phase !== "idle";
  const canStake = !inMatch && !!nextMatchId && balance >= BUY_IN_WEI && !staked;
  const needsClaim = !hasClaimed && balance < BUY_IN_WEI;

  const pending = actions.pending;

  if (!address) return null;

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-200 backdrop-blur">
        <span className="text-zinc-400">balance</span>
        <span className="tabular-nums text-white">
          ${fmtVUSD(balance)} VUSD
        </span>
        {staked && (
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300">
            staked ✓
          </span>
        )}
      </div>

      {pending && (
        <p className="font-mono text-[10px] uppercase tracking-widest text-fuchsia-200 animate-pulse">
          {pending}…
        </p>
      )}

      {!pending && needsClaim && (
        <button
          onClick={() => actions.claim()}
          className="rounded-full bg-white text-black px-5 py-2 text-xs font-semibold transition hover:bg-zinc-200"
        >
          Claim 10 VUSD to play
        </button>
      )}

      {!pending && !needsClaim && canStake && nextMatchId && (
        <button
          onClick={() => actions.stake(nextMatchId, chain.allowance)}
          className="rounded-full bg-fuchsia-500 px-5 py-2 text-xs font-semibold text-black transition hover:bg-fuchsia-400"
        >
          Stake $1 to play
        </button>
      )}

      {!pending && !needsClaim && !staked && !canStake && !inMatch && (
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          free play · no stake
        </p>
      )}

      {actions.error && (
        <p className="max-w-xs rounded bg-red-500/20 px-3 py-1 font-mono text-[10px] text-red-200">
          {actions.error}
        </p>
      )}
    </div>
  );
}
