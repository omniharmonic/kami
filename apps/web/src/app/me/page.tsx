import type { Metadata } from "next";
import Link from "next/link";
import { deleteMyChatsAction, requestEvidenceDeletionAction, setContributeOptInAction } from "@/actions/me";
import { buildMeExport, getContributeOptIn } from "@/lib/governance/me";
import { DownloadJson } from "@/components/governance/DownloadJson";
import { FormMessage } from "@/components/governance/FormMessage";
import { bountyStatusLabel, me as copy } from "@/copy";
import { getDb } from "@/db/client";
import { getMyAttestations, getMyClaims, getMyReputation } from "@/lib/governance/queries";
import { getMyBeings } from "@/lib/governance/my-beings";
import { listDrafts, resumeStep, DONE_STEP } from "@/lib/summon/draft";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** `/me` — profile, claims, attestations, reputation, JSON export, data controls (arch §6.1). */
export default async function MePage({ searchParams }: Props) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) {
    return (
      <section className="section">
        <h1>{copy.title}</h1>
        <p>
          <Link href="/sign-in" className="btn">{copy.signIn}</Link>
        </p>
      </section>
    );
  }
  const user = session.user;
  const db = getDb();
  const [claims, attestations, reputation] = await Promise.all([getMyClaims(user.id), getMyAttestations(user.id), getMyReputation(user.id)]);
  const [beings, drafts] = db ? await Promise.all([getMyBeings(db, user), listDrafts(user.id, { db })]) : [[], []];
  const unfinished = drafts.filter((draft) => resumeStep(draft.data) !== DONE_STEP);
  const optIn = db ? await getContributeOptIn(db, user.id) : false;
  const exportJson = db ? JSON.stringify(await buildMeExport(db, user.id), null, 2) : null;

  return (
    <section className="section">
      <h1>{copy.title}</h1>
      <p><Link href="/guardian" className="btn">Guardian dashboard</Link> <span className="muted">Review invitations, agent controls, and stewardship decisions.</span></p>
      <FormMessage
        ok={typeof sp.ok === "string" ? sp.ok : null}
        error={typeof sp.error === "string" ? sp.error : null}
        okText={{ saved: copy.saved, chats_deleted: "Your chat sessions were deleted.", evidence_deletion: copy.evidenceDeletionNote }}
      />

      <section aria-labelledby="my-beings-h" className="stack" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <h2 id="my-beings-h" style={{ margin: 0 }}>{copy.beings}</h2>
          <Link className="btn" href="/summon">{copy.summon}</Link>
        </div>
        <p className="muted" style={{ margin: 0 }}>{beings.length ? copy.beingsHint : copy.beingsEmpty}</p>
        <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {beings.map((being) => (
            <li key={being.id} className="card stack">
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <strong>{being.name}</strong>
                {being.private ? <span className="chip">{copy.private}</span> : null}
                {being.paused ? <span className="chip">{copy.paused}</span> : null}
                {being.retired ? <span className="chip">{copy.retired}</span> : null}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <Link className="btn" href={`/e/${being.slug}`}>{copy.visit}</Link>
                {being.access.may_view ? <Link className="btn btn-primary" href={`/e/${being.slug}/connect`}>{copy.connectAgent}</Link> : null}
              </div>
            </li>
          ))}
        </ul>
        {unfinished.length ? (
          <div className="stack">
            <h3 style={{ marginBottom: 0 }}>{copy.drafts}</h3>
            {unfinished.map((draft) => {
              const step = resumeStep(draft.data);
              return <div className="sunken" key={draft.id}>
                <strong>{draft.data.place?.name ?? copy.draftUntitled}</strong>
                <p className="muted">{copy.draftStep(step)}</p>
                <Link className="btn" href={`/summon/${draft.id}/${step === 6 ? "review" : step}`}>{copy.resume}</Link>
              </div>;
            })}
          </div>
        ) : null}
      </section>

      <div className="card stack">
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{copy.profile}</h2>
        <p style={{ margin: 0 }}>
          <span className="eyebrow">{copy.email}</span>
          <br />
          {user.email}
        </p>
        <p style={{ margin: 0 }}>
          <span className="eyebrow">{copy.wallet}</span>
          <br />
          <span className="muted">{copy.walletNone}</span>
        </p>
      </div>

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>{copy.reputation}</h2>
      {!reputation ? (
        <p className="muted">{copy.reputationNone}</p>
      ) : (
        <div className="card">
          <p style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700 }}>
            {reputation.score === null ? copy.reputationNew : reputation.score.toFixed(1)}
          </p>
          <p className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
            n = {reputation.n?.toFixed(2) ?? "—"} · p = {reputation.p?.toFixed(2) ?? "—"} · {reputation.entity_id} · computed {reputation.computed_at}
          </p>
          {!reputation.passport_ok && (
            <p className="chip chip-stale" style={{ marginTop: "0.4rem" }}>{copy.reputationUnverified}</p>
          )}
          <p className="faint" style={{ margin: "0.4rem 0 0", fontSize: "0.82rem", wordBreak: "break-all" }}>
            {copy.reputationNote} <code>{reputation.scores_uri}</code>
          </p>
        </div>
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>{copy.claims}</h2>
      {claims.length === 0 ? (
        <p className="muted">{copy.claimsEmpty}</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {claims.map((c) => (
            <li key={c.claim_id} className="card">
              <p style={{ margin: 0, fontWeight: 600 }}>
                {c.slug ? <Link href={`/e/${c.slug}/proposals/${c.bounty_id}`}>{c.title}</Link> : c.title}
              </p>
              <p className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
                {bountyStatusLabel[c.status]} · {c.cap_usdc} USDC · claimed {c.claimed_at}
                {c.released_at ? " · released" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>{copy.attestations}</h2>
      {attestations.length === 0 ? (
        <p className="muted">{copy.attestationsEmpty}</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {attestations.map((a, i) => (
            <li key={`${a.uid ?? i}`} className="card" style={{ fontSize: "0.9rem" }}>
              <strong>{a.outcome}</strong> — {a.bounty_title}
              <br />
              <span className="faint" style={{ wordBreak: "break-all" }}>
                UID: <code>{a.uid ?? "—"}</code>
                {a.attested_at ? ` · ${a.attested_at}` : " · signature pending"}
                {a.audit_of ? " · audit" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>{copy.data}</h2>
      <div className="card stack">
        {exportJson ? (
          <>
            <DownloadJson json={exportJson} filename={`kami-export-${user.id}.json`} />
            <details>
              <summary className="tap" style={{ cursor: "pointer" }}>Preview</summary>
              <pre style={{ overflowX: "auto", fontSize: "0.75rem" }}>{exportJson}</pre>
            </details>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No database is configured, so there is nothing to export yet.</p>
        )}

        <form action={setContributeOptInAction} className="stack">
          <label className="check">
            <input type="checkbox" name="contribute_opt_in" defaultChecked={optIn} />
            <span>{copy.contributeOptIn}</span>
          </label>
          <p className="faint" style={{ margin: 0, fontSize: "0.85rem" }}>{copy.contributeNote}</p>
          <button type="submit" className="btn">Save</button>
        </form>

        <form action={deleteMyChatsAction}>
          <button type="submit" className="btn">{copy.deleteChats}</button>
        </form>

        <form action={requestEvidenceDeletionAction} className="stack">
          <button type="submit" className="btn">{copy.evidenceDeletion}</button>
          <p className="faint" style={{ margin: 0, fontSize: "0.85rem" }}>{copy.evidenceDeletionNote}</p>
        </form>
      </div>
    </section>
  );
}
