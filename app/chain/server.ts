import "server-only";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, RPC_URL } from "./config";

export function getBackendSigner() {
  const pk = process.env.BACKEND_SIGNER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("BACKEND_SIGNER_PRIVATE_KEY not set");
  const account = privateKeyToAccount(pk);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });
  return { account, walletClient };
}
