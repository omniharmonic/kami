import Link from "next/link";
import { guardian, treasury } from "@/copy";
import type { TreasurySummary } from "@/lib/status";
import { getPendingSafeProposalCount } from "@/lib/governance/queries";

export type PayoutView = { id: string; amount_usdc: string; executed_at: string | null; tx_hash: string | null; eas_uid_completed: string | null; title: string | null };

/**
 * PRD §6.1 #6 — balance, pending Safe proposals awaiting guardians, and "what
 * I did with your money": every payout with its transaction hash and
 * attestation UID. Donation copy states what money can and cannot do; no
 * urgency, no recurring default (PRD §13 #2).
 */
export async function Treasury({
  summary,
  payouts,
  safeAddress,
  entityId,
  slug,
}: {
  summary: TreasurySummary | null;
  payouts: PayoutView[];
  safeAddress: string | null;
  entityId?: string;
  slug?: string;
}) {
  const addr = safeAddress ?? summary?.safe_address ?? null;
  const pending = entityId ? await getPendingSafeProposalCount(entityId) : (summary?.pending ?? 0);
  return (
    <section className="section" aria-labelledby="treasury-h">
      <h2 id="treasury-h">{treasury.heading}</h2>
      <div className="card stack">
        <p style={{ margin: 0 }}>
          <span className="eyebrow">{treasury.balance}</span>
          <br />
          <strong>{summary?.balance_usdc ? `${summary.balance_usdc} USDC` : treasury.balanceUnknown}</strong>
          {pending > 0 && <span className="chip" style={{ marginLeft: "0.5rem" }}>{pending} {treasury.pending}</span>}
        </p>
        {addr && (
          <p className="faint" style={{ margin: 0, fontSize: "0.8rem", wordBreak: "break-all" }}>
            Safe: <code>{addr}</code>
          </p>
        )}
        {pending > 0 && <p className="muted" style={{ margin: 0 }}>{guardian.safeProposals}: {pending}</p>}
        <details>
          <summary className="tap" style={{ cursor: "pointer" }}>{treasury.give}</summary>
          <p className="muted" style={{ margin: "0.4rem 0" }}>{treasury.noRecurring}</p>
          <p className="eyebrow" style={{ margin: "0.6rem 0 0.2rem" }}>What money can do</p>
          <ul style={{ margin: 0 }}>{treasury.moneyCanDo.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="eyebrow" style={{ margin: "0.6rem 0 0.2rem" }}>What money cannot do</p>
          <ul style={{ margin: 0 }}>{treasury.moneyCannotDo.map((l) => <li key={l}>{l}</li>)}</ul>
          {slug && (
            <p style={{ margin: "0.6rem 0 0" }}>
              <Link href={`/e/${slug}/donate`} className="btn tap">{treasury.giveCta}</Link>
            </p>
          )}
        </details>
      </div>
      <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.4rem" }}>{treasury.whatIDid}</h3>
      {payouts.length === 0 ? (
        <p className="muted">{treasury.whatIDidEmpty}</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {payouts.map((p) => (
            <li key={p.id} className="card" style={{ fontSize: "0.9rem" }}>
              <strong>{p.amount_usdc} USDC</strong> {p.title ? `— ${p.title}` : ""}
              {p.executed_at && <time dateTime={p.executed_at} className="faint"> · {p.executed_at}</time>}
              <br />
              <span className="faint" style={{ wordBreak: "break-all" }}>
                {treasury.txHash}: <code>{p.tx_hash ?? "—"}</code> · {treasury.attestation}: <code>{p.eas_uid_completed ?? "—"}</code>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
