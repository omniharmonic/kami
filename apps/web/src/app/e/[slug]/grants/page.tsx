import Link from "next/link";
import { requireVisibleEntity } from "@/lib/entity-access";
import { getSession } from "@/lib/session";
import { getDb } from "@/db/client";
import { getGrantBoard } from "@/lib/grants";
import { GrantCards } from "@/components/grants/GrantCards";
import { GrantForm } from "@/components/grants/GrantForm";
import { grants } from "@/copy/grants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grant rounds" };

export default async function GrantsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // This page must authorize independently of the concurrently rendered layout.
  const { entity } = await requireVisibleEntity(slug);
  const session = await getSession();
  const db = getDb();
  const board = db ? await getGrantBoard(db, entity.id, session?.user.id ?? null).catch(() => null) : null;
  return <section className="section" aria-labelledby="grants-page-h">
    <h2 id="grants-page-h">{grants.title}</h2><p>{grants.intro}</p>
    <p className="faint">{grants.budgetNote}</p>
    {entity.paused && <p className="notice">{grants.paused}</p>}
    {!board ? <p role="status">Grant rounds are temporarily unavailable. Please try again.</p> : <>
      <GrantCards slug={slug} rounds={board.rounds.map(round => ({ id: round.id, title: round.title, description: round.purposeMd, status: round.status, budget: round.budgetUsdc, closesAt: round.applicationDeadline.toISOString(), applications: round.applications.length, acceptingApplications: round.acceptingApplications }))} />
      {board.rounds.map(round => <section key={round.id} id={round.id} className="card" aria-label={`${round.title} applications`} style={{ padding: 20, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>{round.title}</h3>
        {round.applications.length ? <ul className="stack">{round.applications.map(application => <li key={application.proposalId}><strong>{application.title}</strong><span className="faint"> — {application.status}</span>{application.bountyIds.map(id => <p key={id}><Link href={`/e/${slug}/proposals/${id}`}>View linked bounty</Link></p>)}</li>)}</ul> : <p className="muted">No applications submitted.</p>}
        {board.mayManage && round.status !== "closed" && <>
          {round.status === "draft" && <GrantForm slug={slug} operation="open" roundId={round.id} disabled={entity.paused} />}
          <GrantForm slug={slug} operation="close" roundId={round.id} />
        </>}
        {round.acceptingApplications && (session ? board.eligibleProposals.length ? <GrantForm slug={slug} operation="apply" roundId={round.id} proposals={board.eligibleProposals} disabled={entity.paused} /> : <p><Link className="btn" href={`/e/${slug}/proposals`}>Write a proposal to apply</Link></p> : <p><Link className="btn" href="/sign-in">Sign in to apply</Link></p>)}
      </section>)}
      {board.mayManage && <details className="card" style={{ padding: 20, marginTop: 20 }}><summary style={{ cursor: "pointer" }}>{grants.create}</summary><GrantForm slug={slug} operation="create" /></details>}
    </>}
    <p className="faint" style={{ marginTop: 20 }}>{grants.reviewNote}</p>
    <Link className="btn" href={`/e/${slug}`}>Back to the habitat</Link>
  </section>;
}
