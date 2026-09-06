import Link from "next/link";
import { board, bountyStatusLabel, proposalsPage } from "@/copy";
import { EvidenceSpecSummary } from "@/components/governance/EvidenceSpecSummary";
import type { EvidenceSpec } from "@/lib/evidence/spec";
import type { BoardSummary } from "@/lib/status";
import { getBoard } from "@/lib/governance/queries";

export type BountyView = { id: string; title: string; status: string; cap_usdc: string; verification_tier: number; deadline: string | null };
export type ProposalView = { id: string; title: string; rank: number | null; rank_reason_md: string | null };

type Row = BountyView & { evidence_spec?: EvidenceSpec };

const PUBLIC_STATES = ["open", "claimed", "in_review", "paid", "deferred"] as const;
const GROUPS: Array<{ label: string; states: string[] }> = [
  { label: proposalsPage.groups.open, states: ["open"] },
  { label: proposalsPage.groups.claimed, states: ["claimed"] },
  { label: proposalsPage.groups.in_review, states: ["in_review"] },
  { label: proposalsPage.groups.paid, states: ["paid", "deferred"] },
];

/**
 * PRD §6.1 #5 — open bounties, claimed, in review, paid, plus open human
 * proposals with the entity's ranking and its stated reason. Given `entityId`
 * it reads the richer board (evidence spec, claim counts); with only the
 * summary props it still renders, so the section survives Neon being down.
 */
export async function Board({
  bounties,
  proposals,
  summary,
  entityId,
  slug,
}: {
  bounties: BountyView[];
  proposals: ProposalView[];
  summary: BoardSummary | null;
  entityId?: string;
  slug?: string;
}) {
  const rich = entityId ? await getBoard(entityId) : null;
  const all: Row[] = rich ? rich.bounties : bounties;
  const rows = all.filter((b) => (PUBLIC_STATES as readonly string[]).includes(b.status));
  const humanProposals = rich ? rich.proposals.filter((p) => p.status === "open") : proposals;

  return (
    <section className="section" aria-labelledby="board-h">
      <h2 id="board-h">{board.heading}</h2>
      {summary && (
        <p className="muted" style={{ margin: "0 0 0.6rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <span className="chip">{summary.open} {board.open}</span>
          <span className="chip">{summary.claimed} {board.claimed}</span>
          <span className="chip">{summary.in_review} {board.in_review}</span>
          <span className="chip">{summary.paid} {board.paid}</span>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="muted">{board.empty}</p>
      ) : (
        GROUPS.map(({ label, states }) => {
          const list = rows.filter((b) => states.includes(b.status));
          if (list.length === 0) return null;
          return (
            <div key={label} style={{ marginBottom: "0.75rem" }}>
              <p className="eyebrow" style={{ margin: "0 0 0.3rem" }}>{label}</p>
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {list.map((b) => (
                  <li key={b.id} className="card">
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {slug ? <Link href={`/e/${slug}/proposals/${b.id}`}>{b.title}</Link> : b.title}
                    </p>
                    <p className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
                      {bountyStatusLabel[b.status] ?? b.status} · {board.cap(b.cap_usdc)} · {board.tier(b.verification_tier)}
                      {b.deadline ? ` · by ${b.deadline}` : ""}
                    </p>
                    {b.evidence_spec && <EvidenceSpecSummary spec={b.evidence_spec} capUsdc={Number(b.cap_usdc)} />}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}

      {humanProposals.length > 0 && (
        <>
          <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.4rem" }}>{board.humanProposals}</h3>
          <ol className="stack" style={{ paddingLeft: "1.2rem", margin: 0 }}>
            {humanProposals.map((p) => (
              <li key={p.id}>
                <span>{p.title}</span>
                {p.rank !== null && <span className="faint"> · {proposalsPage.rankedBy(p.rank)}</span>}
                {p.rank_reason_md && (
                  <p className="faint" style={{ margin: "0.1rem 0 0", fontSize: "0.85rem" }} data-generated="ai">
                    {board.rankReason}: {p.rank_reason_md}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {slug && (
        <p style={{ marginTop: "0.75rem" }}>
          <Link href={`/e/${slug}/proposals`} className="btn">{proposalsPage.propose}</Link>
        </p>
      )}
    </section>
  );
}
