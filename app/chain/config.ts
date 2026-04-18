import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";

export const chain = baseSepolia;

export const RPC_URL =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

export const VUSD_ADDRESS =
  (process.env.NEXT_PUBLIC_VUSD_ADDRESS as Address | undefined) ?? null;

export const ESCROW_ADDRESS =
  (process.env.NEXT_PUBLIC_ESCROW_ADDRESS as Address | undefined) ?? null;

export const BUY_IN_WEI = 1_000_000n; // 1 VUSD at 6 decimals

// Convert the server-side match id (8-char slug) into a bytes32 for on-chain.
export function matchIdToBytes32(id: string): Hex {
  const bytes = new Uint8Array(32);
  const enc = new TextEncoder().encode(id);
  bytes.set(enc.slice(0, 32));
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}

// Feature flag — when false, StakePill, settle-on-end, and on-chain reads
// all short-circuit. The client-side money-flow simulation still runs so
// the visual "streams" UX is unaffected.
export const ONCHAIN_ENABLED =
  (process.env.NEXT_PUBLIC_ONCHAIN_ENABLED ?? "false").toLowerCase() === "true";

export function onChainReady(): boolean {
  return ONCHAIN_ENABLED && !!VUSD_ADDRESS && !!ESCROW_ADDRESS;
}
