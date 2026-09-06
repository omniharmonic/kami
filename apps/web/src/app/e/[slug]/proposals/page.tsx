import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { proposeAction } from "@/actions/governance";
import { EvidenceSpecSummary } from "@/components/governance/EvidenceSpecSummary";
import { FormMessage } from "@/components/governance/FormMessage";
import { board as boardCopy, bountyStatusLabel, errors, proposalsPage as copy } from "@/copy";
import { getEntityBySlug } from "@/lib/entities";
import { requireVisibleEntity } from "@/lib/entity-access";
import { getBoard, type BoardBounty } from "@/lib/governance/queries";
import { getSession } from "@/lib/session";

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  return entity ? { title: copy.title(entity.name), description: copy.intro } : { title: errors.notFound };
}

const GROUPS: Array<{ key: keyof typeof copy.groups; states: BoardBounty["status"][] }> = [
  { key: "open", states: ["open"] },
  { key: "claimed", states: ["claimed"] },
  { key: "in_review", states: ["in_review"] },
  { key: "paid", states: ["paid"] },
  { key: "deferred", states: ["deferred"] },
  { key: "closed", states: ["expired", "withdrawn"] },
];

function BountyLine({ b, slug }: { b: BoardBounty; slug: string }) {
  return (
    <li className="card">
      <p style={{ margin: 0, fontWeight: 600 }}>
        <Link href={`/e/${slug}/proposals/${b.id}`}>{b.title}</Link>
      </p>
      <p className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
        {bountyStatusLabel[b.status]} · {copy.cap(b.cap_usdc)}
        {b.deadline ? ` · ${copy.deadline(b.deadline)}` : ""}
        {b.claims > 0 ? ` · ${b.claims} claimed` : ""}
      </p>
      <EvidenceSpecSummary spec={b.evidence_spec} tier={b.verification_tier} capUsdc={Number(b.cap_usdc)} />
    </li>
  );
}

/**
 * `/e/[slug]/proposals` — the board (arch §6.1). Bounties grouped by state
 * with cap, tier, deadline and evidence spec; human proposals with the
 * entity's rank and its stated reason; a propose form for signed-in people.
 * The EntityShell layout wraps this route, so the disclosure label renders
 * here too (ADR-E13).
 */
export default async function ProposalsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { entity } = await requireVisibleEntity(slug);
  if (!entity) notFound();
  const board = await getBoard(entity.id);
  const session = await getSession();
  const back = `/e/${slug}/proposals`;

  return (
    <>
      <section className="section" aria-labelledby="board-h">
        <h2 id="board-h">{copy.title(entity.name)}</h2>
        <p className="muted">{copy.intro}</p>
        <FormMessage
          ok={typeof sp.ok === "string" ? sp.ok : null}
          error={typeof sp.error === "string" ? sp.error : null}
          okText={{ proposed: copy.proposeThanks, claimed: "Claimed.", released: "Claim released." }}
        />
        {GROUPS.map(({ key, states }) => {
          const list = board.bounties.filter((b) => states.includes(b.status));
          return (
            <div key={key} style={{ marginTop: "1rem" }}>
              <h3 style={{ fontSize: "1rem", margin: "0 0 0.4rem" }}>{copy.groups[key]}</h3>
              {list.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>{copy.emptyGroup}</p>
              ) : (
                <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {list.map((b) => (
                    <BountyLine key={b.id} b={b} slug={slug} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      <section className="section" aria-labelledby="human-proposals-h">
        <h2 id="human-proposals-h">{copy.humanProposals}</h2>
        {board.proposals.length === 0 ? (
          <p className="muted">{copy.humanProposalsEmpty}</p>
        ) : (
          <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {board.proposals.map((p) => (
              <li key={p.id} className="card">
                <p style={{ margin: 0, fontWeight: 600 }}>{p.title}</p>
                <p className="faint" style={{ margin: "0.2rem 0", fontSize: "0.85rem" }}>
                  {p.rank === null ? copy.unranked : copy.rankedBy(p.rank)} · {p.status}
                </p>
                <p style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>{p.body_md}</p>
                {p.rank_reason_md && (
                  <p className="muted" data-generated="ai" style={{ margin: "0.4rem 0 0", fontSize: "0.9rem" }}>
                    {boardCopy.rankReason}: {p.rank_reason_md}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}

        <div className="card stack" style={{ marginTop: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>{copy.propose}</h3>
          <p className="muted" style={{ margin: 0 }}>{copy.proposeIntro}</p>
          {!session ? (
            <p>
              <Link href="/sign-in" className="btn">{copy.proposeSignIn}</Link>
            </p>
          ) : (
            <form action={proposeAction} className="stack">
              <input type="hidden" name="entity_id" value={entity.id} />
              <input type="hidden" name="back" value={back} />
              <label>
                <span className="eyebrow">{copy.proposeTitle}</span>
                <input className="field" name="title" required minLength={3} maxLength={200} />
              </label>
              <label>
                <span className="eyebrow">{copy.proposeBody}</span>
                <textarea className="field" name="body_md" required minLength={10} maxLength={4000} style={{ minHeight: "6rem", paddingBlock: "0.5rem" }} />
              </label>
              <button type="submit" className="btn btn-primary">{copy.proposeSubmit}</button>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
