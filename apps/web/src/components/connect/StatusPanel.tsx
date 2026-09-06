"use client";

/**
 * The live connection status.
 *
 * It renders the status the server already computed, then re-fetches it every
 * few seconds. Two rules it will not break:
 *
 * - **No bare tick.** Every signal renders its state word — not set up /
 *   waiting / seen — and a "seen" always carries the time it was seen and how
 *   long ago. A green dot with no timestamp is exactly the lie this screen
 *   exists to avoid.
 * - **A failed poll is not a red state.** If the status endpoint does not
 *   answer, the panel says the *check* did not answer and keeps the last
 *   values. Nothing about someone's agent is inferred from this page's own
 *   network.
 */
import { useEffect, useState } from "react";
import { connect as copy, humanDuration } from "@/copy";
import type { ConnectStatus, Signal } from "@/lib/connect/status";

const STATE_LABEL: Record<Signal["state"], string> = {
  not_configured: copy.status.stateNotConfigured,
  waiting: copy.status.stateWaiting,
  seen: copy.status.stateSeen,
};

function sentenceFor(signal: Signal): string {
  const s = copy.status.signals[signal.key];
  if (!s) return "";
  if (signal.state === "seen") return s.seen;
  if (signal.state === "waiting") return s.waiting;
  return s.notConfigured;
}

export function SignalRow({ signal }: { signal: Signal }) {
  const s = copy.status.signals[signal.key];
  const extra =
    signal.key === "mcp_tool" && signal.state === "seen" && signal.detail && s?.tool
      ? s.tool(signal.detail)
      : signal.key === "pulse" && signal.state === "seen"
        ? signal.detail === "spoke"
          ? (s?.spoke ?? null)
          : (s?.silent ?? null)
        : signal.state === "seen"
          ? signal.detail
          : null;
  return (
    <li className="sunken" data-signal={signal.key} data-state={signal.state}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.95rem" }}>{s?.label ?? signal.key}</strong>
        <span className={signal.state === "seen" ? "chip chip-live" : "chip chip-stale"} data-testid={`state-${signal.key}`}>
          {STATE_LABEL[signal.state]}
        </span>
      </div>
      {signal.state === "seen" && signal.at ? (
        <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }} data-testid={`at-${signal.key}`}>
          {copy.status.seenAt(signal.at, signal.age_s === null ? "—" : humanDuration(signal.age_s))}
          {extra ? ` · ${extra}` : ""}
        </p>
      ) : null}
      <p style={{ margin: "0.25rem 0 0", fontSize: "0.88rem" }}>{sentenceFor(signal)}</p>
      {s?.note ? <p className="faint" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>{s.note}</p> : null}
    </li>
  );
}

type Props = { initial: ConnectStatus; endpoint: string; intervalMs?: number; poll?: boolean };

export function StatusPanel({ initial, endpoint, intervalMs = 5000, poll = true }: Props) {
  const [status, setStatus] = useState<ConnectStatus>(initial);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!poll) return;
    let live = true;
    const tick = async () => {
      try {
        const res = await fetch(endpoint, { headers: { accept: "application/json" }, cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as ConnectStatus;
        if (!live) return;
        setStatus(next);
        setFailed(false);
      } catch {
        if (live) setFailed(true);
      }
    };
    const timer = setInterval(tick, intervalMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [endpoint, intervalMs, poll]);

  return (
    <section className="section" aria-labelledby="status-h" data-testid="connect-status">
      <h3 id="status-h">{copy.status.heading}</h3>
      <p className="muted" style={{ marginTop: 0 }}>{copy.status.what}</p>
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {status.signals.map((s) => (
          <SignalRow key={s.key} signal={s} />
        ))}
      </ul>
      <p className="faint" style={{ fontSize: "0.8rem" }}>
        {failed ? copy.status.refreshFailed : copy.status.refreshing} {copy.status.lastChecked(status.generated_at)}
      </p>
    </section>
  );
}
