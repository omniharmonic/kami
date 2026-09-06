"use client";

/**
 * `/me/wallet`, everything a person sees: their address (or the button that
 * makes one), the off-ramp link, where their tax position stands, and the
 * plain statement that the key is theirs and we never hold it.
 */
import { useCallback, useState, type ReactNode } from "react";
import { walletCopy } from "./copy";

export type WalletPanelProps = {
  address: string | null;
  chainName: string;
  chainId: number;
  offrampUrl: string | null;
  /** null when Privy is unconfigured */
  createSlot: ReactNode | null;
  tax: { cumulative_usd: number; threshold_usd: number; collected: boolean; collector: "platform" | "sponsor" } | null;
  disconnect?: () => Promise<{ ok: boolean }>;
};

export function WalletPanel({ address, chainName, chainId, offrampUrl, createSlot, tax, disconnect }: WalletPanelProps) {
  const [disconnected, setDisconnected] = useState(false);
  const onDisconnect = useCallback(async () => {
    if (!disconnect) return;
    await disconnect();
    setDisconnected(true);
  }, [disconnect]);

  return (
    <>
      <section className="section" aria-labelledby="wallet-h">
        <h1 id="wallet-h">{walletCopy.title}</h1>
        <p>{walletCopy.intro}</p>
        <div className="card stack">
          <p style={{ margin: 0 }}>
            <span className="eyebrow">{walletCopy.address}</span>
            <br />
            {address && !disconnected ? (
              <code style={{ wordBreak: "break-all" }}>{address}</code>
            ) : (
              <span className="muted">{walletCopy.addressNone}</span>
            )}
          </p>
          <p className="faint" style={{ margin: 0 }}>
            <span className="eyebrow">{walletCopy.network}</span> {chainName} (chain {chainId})
          </p>
          {(!address || disconnected) && (createSlot ?? <p className="muted" style={{ margin: 0 }}>{walletCopy.notConfigured}</p>)}
        </div>
      </section>

      <section className="section" aria-labelledby="keys-h">
        <h2 id="keys-h">{walletCopy.keys.heading}</h2>
        <ul>{walletCopy.keys.body.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="faint" style={{ margin: 0 }}>
          <strong>{walletCopy.keys.export}</strong> — {walletCopy.keys.exportNote}
        </p>
        {address && !disconnected && disconnect && (
          <p style={{ marginTop: "0.6rem" }}>
            <button type="button" className="btn tap" onClick={onDisconnect}>{walletCopy.keys.disconnect}</button>{" "}
            <span className="muted">{walletCopy.keys.disconnectNote}</span>
          </p>
        )}
        {disconnected && <p role="status" className="faint" style={{ margin: 0 }}>{walletCopy.keys.disconnected}</p>}
      </section>

      <section className="section" aria-labelledby="offramp-h">
        <h2 id="offramp-h">{walletCopy.offramp.heading}</h2>
        <p>{walletCopy.offramp.body}</p>
        {offrampUrl ? (
          <p style={{ margin: 0 }}>
            <a className="btn tap" href={offrampUrl} target="_blank" rel="noreferrer noopener">{walletCopy.offramp.link}</a>
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>{walletCopy.offramp.none}</p>
        )}
        <p className="faint" style={{ margin: 0 }}>{walletCopy.offramp.verify}</p>
      </section>

      {tax && (
        <section className="section" aria-labelledby="tax-h">
          <h2 id="tax-h">{walletCopy.tax.heading}</h2>
          {tax.collector === "sponsor" ? (
            <p>{walletCopy.tax.sponsor}</p>
          ) : (
            <p>{tax.collected ? walletCopy.tax.collected : walletCopy.tax.body(tax.cumulative_usd.toFixed(2), tax.threshold_usd.toFixed(2))}</p>
          )}
          <p className="faint" style={{ margin: 0 }}>{walletCopy.tax.notAdvice}</p>
        </section>
      )}
    </>
  );
}
