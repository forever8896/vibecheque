import { createPublicClient, http } from "viem";
import { chain, RPC_URL } from "./config";

// Shared read-only client — safe to use anywhere.
export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});
