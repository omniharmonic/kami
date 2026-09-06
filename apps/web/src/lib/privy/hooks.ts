"use client";

/**
 * The adapter between Privy's embedded wallet and the `signWith` prop
 * `src/components/treasury/SignProposal.tsx` already expects:
 *
 *     signWith?: (params: { address: string; typedDataJson: string }) => Promise<string>
 *
 * `SignProposal` builds nothing — the server hands it the exact EIP-712 SafeTx
 * typed data — so this adapter only parses that JSON and asks Privy to sign it.
 *
 * This module statically imports `@privy-io/react-auth` (React hooks cannot be
 * imported lazily) and is therefore only ever imported from the wallet and
 * guardian trees. The lazy-load guarantee lives in `client.tsx` and is tested.
 */
import { useCallback, useMemo } from "react";
import { usePrivy, useSignTypedData, useWallets } from "@privy-io/react-auth";
import type { SignWith } from "@/components/treasury/SignProposal";

export type PrivySignerState = {
  /** the provider has finished booting */
  ready: boolean;
  authenticated: boolean;
  /** the embedded wallet's address, when there is one */
  address: string | null;
  /** the `signWith` prop, or undefined while no wallet can sign */
  signWith: SignWith | undefined;
  login: () => void;
};

type TypedData = { domain: unknown; types: unknown; primaryType: string; message: unknown };

/** Parse the server's typed-data JSON, refusing anything that is not EIP-712 shaped. */
export function parseTypedData(json: string): TypedData {
  const parsed = JSON.parse(json) as Partial<TypedData>;
  if (!parsed || typeof parsed !== "object" || typeof parsed.primaryType !== "string" || !parsed.types || !parsed.domain) {
    throw new Error("typed data is not EIP-712 shaped");
  }
  return parsed as TypedData;
}

/**
 * `useSignTypedData` in the shape `SignProposal` wants. The address the caller
 * passes wins; otherwise the embedded wallet is used.
 */
export function usePrivySignTypedData(): PrivySignerState {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();

  const embedded = useMemo(() => wallets.find((w) => w.walletClientType === "privy") ?? wallets[0] ?? null, [wallets]);
  const address = embedded?.address ?? null;

  const signWith = useCallback<SignWith>(
    async ({ address: requested, typedDataJson }) => {
      const typed = parseTypedData(typedDataJson);
      const who = requested || address || undefined;
      const { signature } = await signTypedData(typed as Parameters<typeof signTypedData>[0], who ? { address: who } : undefined);
      return signature;
    },
    [address, signTypedData],
  );

  return {
    ready,
    authenticated,
    address,
    signWith: ready && authenticated && address ? signWith : undefined,
    login,
  };
}
