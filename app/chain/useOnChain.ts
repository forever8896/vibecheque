"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import {
  createWalletClient,
  custom,
  http,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { publicClient } from "./clients";
import { vibeEscrowAbi, vibeUsdAbi } from "./abis";
import {
  BUY_IN_WEI,
  ESCROW_ADDRESS,
  VUSD_ADDRESS,
  chain,
  matchIdToBytes32,
  onChainReady,
} from "./config";

type OnChainState = {
  address: Address | null;
  balance: bigint; // VUSD (6 decimals)
  hasClaimed: boolean;
  allowance: bigint;
  stakedInNext: bigint; // stake in the nextMatchId
  stakedInActive: bigint; // stake in the currently-running match
  refreshing: boolean;
  refresh: () => Promise<void>;
};

export function useOnChain(opts: {
  nextMatchId: string | null;
  activeMatchId: string | null;
}): OnChainState {
  const { nextMatchId, activeMatchId } = opts;
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();

  const address = useMemo<Address | null>(() => {
    if (!authenticated) return null;
    const w = wallets[0];
    if (!w?.address) return null;
    return w.address as Address;
  }, [authenticated, wallets]);

  const [balance, setBalance] = useState(0n);
  const [hasClaimed, setHasClaimed] = useState(false);
  const [allowance, setAllowance] = useState(0n);
  const [stakedInNext, setStakedInNext] = useState(0n);
  const [stakedInActive, setStakedInActive] = useState(0n);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!address || !onChainReady() || !VUSD_ADDRESS || !ESCROW_ADDRESS) return;
    setRefreshing(true);
    try {
      const [bal, claimed, allow] = await Promise.all([
        publicClient.readContract({
          address: VUSD_ADDRESS,
          abi: vibeUsdAbi,
          functionName: "balanceOf",
          args: [address],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: VUSD_ADDRESS,
          abi: vibeUsdAbi,
          functionName: "hasClaimed",
          args: [address],
        }) as Promise<boolean>,
        publicClient.readContract({
          address: VUSD_ADDRESS,
          abi: vibeUsdAbi,
          functionName: "allowance",
          args: [address, ESCROW_ADDRESS],
        }) as Promise<bigint>,
      ]);
      setBalance(bal);
      setHasClaimed(claimed);
      setAllowance(allow);

      if (nextMatchId) {
        const s = (await publicClient.readContract({
          address: ESCROW_ADDRESS,
          abi: vibeEscrowAbi,
          functionName: "stakes",
          args: [matchIdToBytes32(nextMatchId), address],
        })) as bigint;
        setStakedInNext(s);
      } else {
        setStakedInNext(0n);
      }

      if (activeMatchId) {
        const s = (await publicClient.readContract({
          address: ESCROW_ADDRESS,
          abi: vibeEscrowAbi,
          functionName: "stakes",
          args: [matchIdToBytes32(activeMatchId), address],
        })) as bigint;
        setStakedInActive(s);
      } else {
        setStakedInActive(0n);
      }
    } catch (err) {
      console.warn("[onchain] read failed", err);
    } finally {
      setRefreshing(false);
    }
  }, [address, nextMatchId, activeMatchId]);

  // Refetch on address or match id change, plus a slow poll while mounted.
  // Skip entirely when on-chain is disabled so there's zero network chatter.
  useEffect(() => {
    if (!onChainReady()) return;
    void refresh();
    const id = setInterval(refresh, 8_000);
    return () => clearInterval(id);
  }, [refresh]);

  return {
    address,
    balance,
    hasClaimed,
    allowance,
    stakedInNext,
    stakedInActive,
    refreshing,
    refresh,
  };
}

type PrivyWallet = {
  address: string;
  getEthereumProvider: () => Promise<EIP1193Provider>;
};

async function makeWalletClient(
  wallet: PrivyWallet,
): Promise<WalletClient | null> {
  try {
    const provider = await wallet.getEthereumProvider();
    return createWalletClient({
      account: wallet.address as Address,
      chain,
      transport: custom(provider),
    });
  } catch (err) {
    console.warn("[onchain] wallet provider unavailable", err);
    return null;
  }
}

export function useStakeActions(opts: {
  refresh: () => Promise<void>;
}) {
  const { wallets } = useWallets();
  const [pending, setPending] = useState<
    | null
    | "switching"
    | "claiming"
    | "approving"
    | "staking"
    | "settling"
  >(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const walletOrNull = wallets[0] as PrivyWallet | undefined;

  async function ensureChain(wallet: PrivyWallet) {
    // Privy wallets expose switchChain via their higher-level API; as a
    // fallback attempt wallet_switchEthereumChain via the EIP-1193 provider.
    const provider = await wallet.getEthereumProvider();
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${chain.id.toString(16)}` }],
      });
    } catch {
      /* ignore — user may already be on the chain */
    }
  }

  const claim = useCallback(async () => {
    if (!walletOrNull || !VUSD_ADDRESS) return;
    setError(null);
    setPending("switching");
    try {
      await ensureChain(walletOrNull);
      const wc = await makeWalletClient(walletOrNull);
      if (!wc) throw new Error("wallet unavailable");
      setPending("claiming");
      const hash = await wc.writeContract({
        address: VUSD_ADDRESS,
        abi: vibeUsdAbi,
        functionName: "claim",
        args: [],
        account: walletOrNull.address as Address,
        chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setLastTx(hash);
      await opts.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }, [walletOrNull, opts]);

  const stake = useCallback(
    async (matchId: string, currentAllowance: bigint) => {
      if (!walletOrNull || !VUSD_ADDRESS || !ESCROW_ADDRESS) return;
      setError(null);
      try {
        await ensureChain(walletOrNull);
        const wc = await makeWalletClient(walletOrNull);
        if (!wc) throw new Error("wallet unavailable");

        if (currentAllowance < BUY_IN_WEI) {
          setPending("approving");
          const approveHash = await wc.writeContract({
            address: VUSD_ADDRESS,
            abi: vibeUsdAbi,
            functionName: "approve",
            args: [ESCROW_ADDRESS, BUY_IN_WEI * 10n],
            account: walletOrNull.address as Address,
            chain,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        setPending("staking");
        const stakeHash = await wc.writeContract({
          address: ESCROW_ADDRESS,
          abi: vibeEscrowAbi,
          functionName: "stake",
          args: [matchIdToBytes32(matchId), BUY_IN_WEI],
          account: walletOrNull.address as Address,
          chain,
        });
        await publicClient.waitForTransactionReceipt({ hash: stakeHash });
        setLastTx(stakeHash);
        await opts.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPending(null);
      }
    },
    [walletOrNull, opts],
  );

  return {
    ready: !!walletOrNull,
    pending,
    lastTx,
    error,
    claim,
    stake,
    clearError: () => setError(null),
  };
}
