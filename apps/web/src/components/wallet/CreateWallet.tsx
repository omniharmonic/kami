"use client";

/**
 * The create-on-demand button. Rendered **only** inside `WalletProvider`, on
 * `/me/wallet` — one of the three surfaces ADR-E07 allows Privy on.
 *
 * It logs the person into the wallet provider, hands the server the access
 * token, and the server stores `privy_did` + `wallet_address`. No key is
 * produced, requested or transported here.
 */
import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { walletCopy } from "./copy";

export type CreateWalletProps = {
  /** server action: verifies the token and stores the address */
  link: (token: string) => Promise<{ ok: boolean; address?: string | null; message?: string }>;
};

export function CreateWallet({ link }: CreateWalletProps) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [phase, setPhase] = useState<"idle" | "busy" | "error" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    setPhase("busy");
    setMessage(null);
    try {
      if (!authenticated) {
        login();
        setPhase("idle");
        return;
      }
      const token = await getAccessToken();
      if (!token) {
        setPhase("error");
        setMessage(walletCopy.createFailed);
        return;
      }
      const res = await link(token);
      if (!res.ok) {
        setPhase("error");
        setMessage(res.message ?? walletCopy.createFailed);
        return;
      }
      setPhase("done");
      setMessage(walletCopy.linked);
    } catch {
      setPhase("error");
      setMessage(walletCopy.createFailed);
    }
  }, [authenticated, getAccessToken, link, login]);

  return (
    <div className="stack">
      <button type="button" className="btn btn-primary tap" onClick={onClick} disabled={!ready || phase === "busy"} aria-busy={phase === "busy"}>
        {phase === "busy" ? walletCopy.creating : walletCopy.create}
      </button>
      <p className="muted" style={{ margin: 0 }}>{walletCopy.createNote}</p>
      {message && (
        <p role="status" className={phase === "error" ? "muted" : "faint"} style={{ margin: 0 }}>
          {message}
        </p>
      )}
    </div>
  );
}
