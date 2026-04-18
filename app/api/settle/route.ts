import { NextRequest, NextResponse } from "next/server";
import type { Address, Hex } from "viem";
import { getBackendSigner } from "@/app/chain/server";
import { publicClient } from "@/app/chain/clients";
import { vibeEscrowAbi } from "@/app/chain/abis";
import {
  ESCROW_ADDRESS,
  matchIdToBytes32,
  onChainReady,
} from "@/app/chain/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PayoutInput = { address: string; amount: number };

// Avoid burning gas on concurrent settle POSTs for the same match
const g = globalThis as unknown as { __settle_inflight?: Set<string> };
const inflight = g.__settle_inflight ?? (g.__settle_inflight = new Set());

// POST /api/settle
// Body: { matchId: string, payouts: [{address, amount: usdAmount>=0}] }
// Server signs settle() with amounts converted to 6-decimal micro-units.
export async function POST(req: NextRequest) {
  if (!onChainReady() || !ESCROW_ADDRESS) {
    return NextResponse.json(
      { error: "on-chain not configured" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    matchId?: string;
    payouts?: PayoutInput[];
  };

  const matchId = typeof body.matchId === "string" ? body.matchId : "";
  const payouts = Array.isArray(body.payouts) ? body.payouts : [];
  if (!matchId || payouts.length === 0) {
    return NextResponse.json(
      { error: "matchId + payouts required" },
      { status: 400 },
    );
  }

  if (inflight.has(matchId)) {
    return NextResponse.json({ ok: true, inflight: true });
  }

  const matchBytes = matchIdToBytes32(matchId);

  // Idempotency: already settled?
  try {
    const already = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: vibeEscrowAbi,
      functionName: "settled",
      args: [matchBytes],
    })) as boolean;
    if (already) {
      return NextResponse.json({ ok: true, alreadySettled: true });
    }
  } catch {
    // If we can't read, fall through to tx; the tx will revert if already settled
  }

  // Filter + convert winnings. Skip losers (net ≤ 0); they lose their stake.
  const winners: Address[] = [];
  const amounts: bigint[] = [];
  for (const p of payouts) {
    if (!p.address || typeof p.amount !== "number") continue;
    if (p.amount <= 0) continue;
    if (!/^0x[0-9a-fA-F]{40}$/.test(p.address)) continue;
    // Round to 6-decimal micros, floor to avoid over-distributing
    const micros = BigInt(Math.floor(p.amount * 1_000_000));
    if (micros <= 0n) continue;
    winners.push(p.address as Address);
    amounts.push(micros);
  }

  if (winners.length === 0) {
    return NextResponse.json({ ok: true, noWinners: true });
  }

  // Optional sanity check: total ≤ on-chain pool
  try {
    const pool = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: vibeEscrowAbi,
      functionName: "pools",
      args: [matchBytes],
    })) as bigint;
    const sum = amounts.reduce((s, a) => s + a, 0n);
    if (sum > pool) {
      // Scale amounts down proportionally to fit pool
      for (let i = 0; i < amounts.length; i++) {
        amounts[i] = (amounts[i] * pool) / sum;
      }
    }
  } catch {
    // Ignore; tx will revert if over-distributed
  }

  inflight.add(matchId);
  try {
    const { walletClient, account } = getBackendSigner();
    const hash: Hex = await walletClient.writeContract({
      address: ESCROW_ADDRESS,
      abi: vibeEscrowAbi,
      functionName: "settle",
      args: [matchBytes, winners, amounts],
      account,
      chain: walletClient.chain,
    });
    return NextResponse.json({
      ok: true,
      txHash: hash,
      winners,
      amounts: amounts.map((a) => a.toString()),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[settle] failed", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    inflight.delete(matchId);
  }
}
