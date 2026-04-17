"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center">
        <div>
          <p className="font-mono text-sm opacity-70">
            NEXT_PUBLIC_PRIVY_APP_ID is not set. Add it to .env.local to boot
            the app.
          </p>
          <div className="mt-6 opacity-50">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "wallet", "google"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia],
        appearance: {
          theme: "dark",
          accentColor: "#ff4df0",
          logo: undefined,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
