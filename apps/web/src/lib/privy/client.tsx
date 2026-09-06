"use client";

/**
 * The Privy provider, mounted **only** on the three surfaces ADR-E07 names:
 * `/me/wallet`, the claim button, and the guardian-accept / guardian-sign
 * screen. Visitors, readers and donors must never pay for it, so:
 *
 *  - `@privy-io/react-auth` is behind `next/dynamic(..., { ssr: false })`,
 *    which keeps it in its own client chunk and out of every server render;
 *  - nothing in `src/app/page.tsx`, `src/app/e/[slug]/**` or
 *    `src/components/donate/**` imports this file — asserted by
 *    `src/lib/privy/__tests__/lazy.test.ts`, which walks the import graph.
 *
 * The app id arrives as a prop from a server component, so no `NEXT_PUBLIC_*`
 * variable is needed for it (CLAUDE.md).
 */
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

type ProviderProps = { appId: string; config?: Record<string, unknown>; children: ReactNode };

const LazyPrivyProvider = dynamic(
  async () => {
    const mod = await import("@privy-io/react-auth");
    return { default: mod.PrivyProvider as unknown as (p: ProviderProps) => ReactNode };
  },
  { ssr: false },
);

export type WalletProviderProps = {
  /** `config.privy_app_id` / `PRIVY_APP_ID`, read on the server and passed down. */
  appId: string | null;
  children: ReactNode;
};

/**
 * Renders children untouched when no app id is configured, so every wallet
 * surface degrades to "wallets are not switched on" rather than crashing.
 */
export function WalletProvider({ appId, children }: WalletProviderProps) {
  if (!appId) return <>{children}</>;
  return (
    <LazyPrivyProvider
      appId={appId}
      config={{
        // Email-first: Better Auth already knows who this is; Privy only holds keys.
        loginMethods: ["email"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        appearance: { walletList: [] },
      }}
    >
      {children}
    </LazyPrivyProvider>
  );
}

export default WalletProvider;
