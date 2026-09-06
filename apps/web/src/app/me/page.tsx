import type { Metadata } from "next";
import Link from "next/link";
import { deleteMyChatsAction, requestEvidenceDeletionAction, setContributeOptInAction } from "@/actions/me";
import { buildMeExport, getContributeOptIn } from "@/lib/governance/me";
import { DownloadJson } from "@/components/governance/DownloadJson";
import { FormMessage } from "@/components/governance/FormMessage";
import { bountyStatusLabel, me as copy } from "@/copy";
import { getDb } from "@/db/client";
import { getMyAttestations, getMyClaims, getMyReputation } from "@/lib/governance/queries";
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
  const optIn = db ? await getContributeOptIn(db, user.id) : false;
  const exportJson = db ? JSON.stringify(await buildMeExport(db, user.id), null, 2) : null;

  return (
    <section className="section">
      <h1>{copy.title}</h1>
      <FormMessage
        ok={typeof sp.ok === "string" ? sp.ok : null}
        error={typeof sp.error === "string" ? sp.error : null}
        okText={{ saved: copy.saved, chats_deleted: "Your chat sessions were deleted.", evidence_deletion: copy.evidenceDeletionNote }}
      />

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
