"use client";

/**
 * The Sign button on `/guardian/proposals/[hash]`. It signs the Safe EIP-712
 * `SafeTx` typed data that the server built (never data assembled in the
 * browser), then posts the signature to `POST /api/treasury/confirm`, which
 * forwards it to the Transaction Service.
 *
 * `signWith` is the injection point for WP11's Privy wiring: any
 * `(params) => Promise<signature>` works. Without it the component falls back
 * to injected `window.ethereum` (`eth_signTypedData_v4`) for guardians using
 * their own wallet, and the Safe{Wallet} link stays as the escape hatch.
 */
import { useCallback, useMemo, useState } from "react";
import { treasuryCopy } from "@/lib/treasury/copy";

export type SignTypedDataParams = { address: string; typedDataJson: string };
export type SignWith = (params: SignTypedDataParams) => Promise<string>;

export type SignProposalProps = {
  safeTxHash: string;
  typedDataJson: string | null;
  confirmations: number;
  required: number;
  status: string;
  safeWalletUrl: string | null;
  signWith?: SignWith;
  /** test seam for the injected-provider path */
  provider?: Eip1193Like;
};

export interface Eip1193Like {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function injectedProvider(): Eip1193Like | null {
  const w = globalThis as unknown as { ethereum?: Eip1193Like };
  return w.ethereum ?? null;
}

/** Sign with an EIP-1193 provider: accounts first, then `eth_signTypedData_v4`. */
export async function signWithProvider(provider: Eip1193Like, typedDataJson: string): Promise<{ signature: string; address: string }> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("no_account");
  const signature = (await provider.request({ method: "eth_signTypedData_v4", params: [address, typedDataJson] })) as string;
  return { signature, address };
}

type State = { phase: "idle" | "signing" | "submitting" | "done" | "error"; message: string | null; confirmations: number };

export function SignProposal({ safeTxHash, typedDataJson, confirmations, required, status, safeWalletUrl, signWith, provider }: SignProposalProps) {
  const [state, setState] = useState<State>({ phase: "idle", message: null, confirmations });
  const pending = status === "pending";
  const eip1193 = useMemo(() => provider ?? injectedProvider(), [provider]);

  const onSign = useCallback(async () => {
    if (!typedDataJson) return;
    setState((s) => ({ ...s, phase: "signing", message: null }));
    let signature: string;
    try {
      if (signWith) {
        signature = await signWith({ address: "", typedDataJson });
      } else if (eip1193) {
        signature = (await signWithProvider(eip1193, typedDataJson)).signature;
      } else {
        setState((s) => ({ ...s, phase: "error", message: treasuryCopy.sign.noWallet }));
        return;
      }
    } catch {
      setState((s) => ({ ...s, phase: "error", message: treasuryCopy.sign.rejected }));
      return;
    }
    setState((s) => ({ ...s, phase: "submitting" }));
    try {
      const res = await fetch("/api/treasury/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ safe_tx_hash: safeTxHash, signature }),
      });
      const body = (await res.json().catch(() => ({}))) as { confirmations?: number; required?: number; detail?: string };
      if (!res.ok) {
        setState((s) => ({ ...s, phase: "error", message: body.detail ?? treasuryCopy.sign.failed }));
        return;
      }
      const n = body.confirmations ?? state.confirmations + 1;
      setState({ phase: "done", message: treasuryCopy.sign.done(n, body.required ?? required), confirmations: n });
    } catch {
      setState((s) => ({ ...s, phase: "error", message: treasuryCopy.sign.failed }));
    }
  }, [eip1193, required, safeTxHash, signWith, state.confirmations, typedDataJson]);

  const busy = state.phase === "signing" || state.phase === "submitting";
  return (
    <div className="stack">
      <p className="faint" style={{ margin: 0 }}>
        <span className="eyebrow">{treasuryCopy.sign.what}</span>
        <br />
        {treasuryCopy.sign.whatBody}
      </p>
      <p style={{ margin: 0 }}>
        <span className="chip">{treasuryCopy.page.confirmations(state.confirmations, required)}</span>
      </p>
      <button
        type="button"
        className="btn btn-primary tap"
        onClick={onSign}
        disabled={!pending || busy || state.phase === "done" || !typedDataJson}
        aria-busy={busy}
      >
        {state.phase === "signing" ? treasuryCopy.sign.signing : state.phase === "submitting" ? treasuryCopy.sign.submitting : treasuryCopy.sign.button}
      </button>
      {!pending && <p className="muted" style={{ margin: 0 }}>{treasuryCopy.page.alreadyDone}</p>}
      {state.message && (
        <p role="status" className={state.phase === "error" ? "muted" : "faint"} style={{ margin: 0 }}>
          {state.message}
        </p>
      )}
      {safeWalletUrl && (
        <p style={{ margin: 0 }}>
          <a className="tap" href={safeWalletUrl} target="_blank" rel="noreferrer noopener">
            {treasuryCopy.page.signInSafe}
          </a>
        </p>
      )}
    </div>
  );
}
