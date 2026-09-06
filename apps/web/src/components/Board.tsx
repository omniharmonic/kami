import { board } from "@/copy";
import type { BoardSummary } from "@/lib/status";

export type BountyView = { id: string; title: string; status: string; cap_usdc: string; verification_tier: number; deadline: string | null };
export type ProposalView = { id: string; title: string; rank: number | null; rank_reason_md: string | null };

export function Board({ bounties, proposals, summary }: { bounties: BountyView[]; proposals: ProposalView[]; summary: BoardSummary | null }) {
  const publicStates = new Set(["open", "claimed", "in_review", "paid", "deferred"]);
  const visible = bounties.filter((b) => publicStates.has(b.status));
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
      {visible.length === 0 ? (
        <p className="muted">{board.empty}</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {visible.map((b) => (
            <li key={b.id} className="card">
              <p style={{ margin: 0, fontWeight: 600 }}>{b.title}</p>
              <p className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
                {(board as Record<string, unknown>)[b.status] as string} · {board.cap(b.cap_usdc)} · {board.tier(b.verification_tier)}
                {b.deadline ? ` · by ${b.deadline}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {proposals.length > 0 && (
        <>
          <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.4rem" }}>{board.humanProposals}</h3>
          <ol className="stack" style={{ paddingLeft: "1.2rem", margin: 0 }}>
            {proposals.map((p) => (
              <li key={p.id}>
                <span>{p.title}</span>
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
    </section>
  );
}
