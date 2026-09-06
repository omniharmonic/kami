import type { Metadata } from "next";
import Link from "next/link";
import {
  approveBountyAction,
  grantRoleAction,
  inviteGuardianAction,
  pauseAction,
  ratifyStrategyAction,
  requestResumeAction,
  retireAction,
  revokeRoleAction,
  withdrawBountyAction,
} from "@/actions/governance";
import { EvidenceSpecSummary } from "@/components/governance/EvidenceSpecSummary";
import { FormMessage } from "@/components/governance/FormMessage";
import { guardian as copy, tierLabel } from "@/copy";
import { getGuardianDashboard, type GuardianEntity } from "@/lib/governance/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, description: copy.intro, robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function DraftCard({ e, draft }: { e: GuardianEntity; draft: GuardianEntity["drafts"][number] }) {
  return (
    <li className="card stack">
      <p style={{ margin: 0, fontWeight: 600 }}>{draft.title}</p>
      {draft.status === "held_by_guard" && <p style={{ margin: 0, color: "var(--danger)" }}>{copy.heldByGuard}</p>}
      <p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap" }} data-generated="ai">{draft.why_md}</p>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{draft.deliverable_md}</p>
      <EvidenceSpecSummary spec={draft.evidence_spec} tier={draft.verification_tier} capUsdc={Number(draft.cap_usdc)} />
      <p className="faint" style={{ margin: 0, fontSize: "0.8rem", wordBreak: "break-all" }}>
        spec sha256: <code>{draft.spec_sha256}</code>
        <br />
        {copy.edit.locked}: <code>{e.entity_id}</code>, {draft.twin_refs.join(", ")}
      </p>

      <form action={approveBountyAction} className="stack">
        <input type="hidden" name="bounty_id" value={draft.id} />
        <input type="hidden" name="back" value="/guardian" />
        <details>
          <summary className="tap" style={{ cursor: "pointer" }}>{copy.approveAndEdit}</summary>
          <div className="stack" style={{ marginTop: "0.5rem" }}>
            <label>
              <span className="eyebrow">{copy.edit.title}</span>
              <input className="field" name="title" defaultValue={draft.title} />
            </label>
            <label>
              <span className="eyebrow">{copy.edit.why}</span>
              <textarea className="field" name="why" defaultValue={draft.why_md} style={{ minHeight: "4rem", paddingBlock: "0.5rem" }} />
            </label>
            <label>
              <span className="eyebrow">{copy.edit.deliverable}</span>
              <textarea className="field" name="deliverable" defaultValue={draft.deliverable_md} style={{ minHeight: "4rem", paddingBlock: "0.5rem" }} />
            </label>
            <label>
              <span className="eyebrow">{copy.edit.tier}</span>
              <select className="field" name="verification_tier" defaultValue={String(draft.verification_tier)}>
                {[1, 2, 3, 4].map((t) => (
                  <option key={t} value={t}>{tierLabel[t]}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="eyebrow">{copy.edit.cap}</span>
              <input className="field" name="cap_usdc" type="number" step="0.01" min="1" defaultValue={draft.cap_usdc} />
            </label>
            <label>
              <span className="eyebrow">{copy.edit.claimLimit}</span>
              <input className="field" name="claim_limit" type="number" min="1" defaultValue={draft.claim_limit} />
            </label>
            <label>
              <span className="eyebrow">{copy.edit.deadline}</span>
              <input className="field" name="deadline" type="date" defaultValue={draft.deadline ?? ""} />
            </label>
            <label>
              <span className="eyebrow">{copy.edit.minPhotos}</span>
              <input className="field" name="min_photos" type="number" min="0" max="30" defaultValue={draft.evidence_spec.min_photos} />
            </label>
            <label>
              <span className="eyebrow">{copy.edit.gpsWithin}</span>
              <input className="field" name="gps_within_m" defaultValue={draft.evidence_spec.gps_within_m ?? "none"} />
            </label>
            <label>
              <span className="eyebrow">{copy.edit.secondAbove}</span>
              <input className="field" name="second_attestation_above_usdc" type="number" step="1" min="0" defaultValue={draft.evidence_spec.second_attestation_above_usdc} />
            </label>
            <label className="check">
              <input type="checkbox" name="exif_required" defaultChecked={draft.evidence_spec.exif_required} />
              <span>{copy.edit.exifRequired}</span>
            </label>
            <label className="check">
              <input type="checkbox" name="capture_in_app" defaultChecked={draft.evidence_spec.capture === "in_app"} />
              <span>{copy.edit.inApp}</span>
            </label>
          </div>
        </details>
        <button type="submit" className="btn btn-primary">{copy.approve}</button>
        <p className="faint" style={{ margin: 0, fontSize: "0.8rem" }}>{copy.approvals(0, e.approvals_required)}</p>
      </form>

      <form action={withdrawBountyAction}>
        <input type="hidden" name="bounty_id" value={draft.id} />
        <input type="hidden" name="back" value="/guardian" />
        <button type="submit" className="btn">{copy.withdraw}</button>
      </form>
    </li>
  );
}

/** `/guardian` — my entities: drafts to approve or edit, pause/resume/retire, invites, Safe proposals (arch §6.1). */
export default async function GuardianPage({ searchParams }: Props) {
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
  const entities = await getGuardianDashboard(session.user.id);

  return (
    <section className="section">
      <h1>{copy.title}</h1>
      <p className="muted">{copy.intro}</p>
      <FormMessage
        ok={typeof sp.ok === "string" ? sp.ok : null}
        error={typeof sp.error === "string" ? sp.error : null}
        okText={{
          approved: "Approved.",
          withdrawn: "Withdrawn.",
          paused: "Paused.",
          resume_requested: copy.resumeHint,
          retire_requested: copy.retireRequested,
          invited: copy.inviteSent,
          granted: copy.granted,
          revoked: "Role revoked.",
          ratified: "Strategy ratified.",
        }}
      />
      {entities.length === 0 && <p className="muted">{copy.noEntities}</p>}

      {entities.map((e) => (
        <article key={e.entity_id} className="card stack" style={{ marginTop: "1.25rem" }}>
          <header>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
              <Link href={`/e/${e.slug}`}>{e.name}</Link>{" "}
              <span className="chip">{e.retired_at ? copy.retired : e.paused_at ? copy.paused : copy.live}</span>
            </h2>
            <p className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
              {e.roles.join(", ")} · {e.two_non_founder_guardians ? copy.twoNonFounder : copy.notTwoNonFounder}
            </p>
          </header>

          <div>
            <h3 style={{ fontSize: "1rem", margin: "0 0 0.4rem" }}>{copy.drafts}</h3>
            {e.drafts.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{copy.draftsEmpty}</p>
            ) : (
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {e.drafts.map((d) => (
                  <DraftCard key={d.id} e={e} draft={d} />
                ))}
              </ul>
            )}
          </div>

          <div className="stack">
            <h3 style={{ fontSize: "1rem", margin: 0 }}>Pause</h3>
            {e.paused_at ? (
              <>
                <p className="muted" style={{ margin: 0 }}>
                  {copy.paused} · {copy.resumeRequests(e.resume_requests.length)} · {copy.resumeHint}
                </p>
                <form action={requestResumeAction}>
                  <input type="hidden" name="entity_id" value={e.entity_id} />
                  <button type="submit" className="btn btn-primary" disabled={Boolean(e.retired_at)}>{copy.resume}</button>
                </form>
              </>
            ) : (
              <>
                <p className="muted" style={{ margin: 0 }}>{copy.pauseHint}</p>
                <form action={pauseAction}>
                  <input type="hidden" name="entity_id" value={e.entity_id} />
                  <button type="submit" className="btn">{copy.pause}</button>
                </form>
              </>
            )}
            {!e.retired_at && (
              <details>
                <summary className="tap" style={{ cursor: "pointer" }}>{copy.retire}</summary>
                <p className="muted">{copy.retireHint}</p>
                {e.retire_requests.length > 0 && <p className="muted">{copy.retireRequested}</p>}
                <form action={retireAction}>
                  <input type="hidden" name="entity_id" value={e.entity_id} />
                  <button type="submit" className="btn">{copy.retire}</button>
                </form>
              </details>
            )}
          </div>

          <div className="stack">
            <h3 style={{ fontSize: "1rem", margin: 0 }}>{copy.safeProposals}</h3>
            {e.safe_proposals.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{copy.safeProposalsEmpty}</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                {e.safe_proposals.map((s) => (
                  <li key={s.safe_tx_hash}>
                    {s.amount_usdc ?? "—"} USDC · {s.confirmations} confirmations ·{" "}
                    <Link href={`/guardian/proposals/${s.safe_tx_hash}`}>{copy.safeProposalLink}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {e.strategies_awaiting.length > 0 && (
            <div className="stack">
              <h3 style={{ fontSize: "1rem", margin: 0 }}>Strategy memos awaiting ratification</h3>
              <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
                {e.strategies_awaiting.map((s) => (
                  <li key={s.id} style={{ marginBottom: "0.4rem" }}>
                    {s.quarter}
                    {s.comment_open_until && <span className="faint"> · open for comment until {s.comment_open_until}</span>}
                    {e.roles.includes("steward") && (
                      <form action={ratifyStrategyAction} style={{ display: "inline-block", marginLeft: "0.5rem" }}>
                        <input type="hidden" name="strategy_id" value={s.id} />
                        <button type="submit" className="btn">Ratify</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="stack">
            <h3 style={{ fontSize: "1rem", margin: 0 }}>{copy.invites}</h3>
            <form action={inviteGuardianAction} className="stack">
              <input type="hidden" name="entity_id" value={e.entity_id} />
              <label>
                <span className="eyebrow">{copy.inviteEmail}</span>
                <input className="field" type="email" name="email" required />
              </label>
              <button type="submit" className="btn">{copy.inviteSend}</button>
            </form>
            <p className="faint" style={{ margin: 0, fontSize: "0.85rem" }}>{copy.inviteRoleNote}</p>
            {e.invites.length > 0 && (
              <>
                <p className="eyebrow" style={{ margin: 0 }}>{copy.pendingInvites}</p>
                <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                  {e.invites.map((i) => (
                    <li key={i.id}>
                      {i.email} · expires {i.expires_at}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <form action={grantRoleAction} className="stack">
              <input type="hidden" name="entity_id" value={e.entity_id} />
              <label>
                <span className="eyebrow">{copy.grantRole}</span>
                <input className="field" type="email" name="email" required />
              </label>
              <label>
                <span className="eyebrow">Role</span>
                <select className="field" name="role" defaultValue="evaluator">
                  <option value="evaluator">evaluator</option>
                  <option value="steward">steward</option>
                  <option value="guardian">guardian</option>
                </select>
              </label>
              <button type="submit" className="btn">{copy.grantSend}</button>
            </form>

            <p className="eyebrow" style={{ margin: 0 }}>{copy.roles}</p>
            <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
              {e.people.map((p) => (
                <li key={`${p.user_id}-${p.role}`} style={{ display: "flex", gap: "0.5rem", alignItems: "center", minHeight: "var(--tap)" }}>
                  <span>
                    {p.name} — {p.role}
                  </span>
                  <form action={revokeRoleAction}>
                    <input type="hidden" name="entity_id" value={e.entity_id} />
                    <input type="hidden" name="user_id" value={p.user_id} />
                    <input type="hidden" name="role" value={p.role} />
                    <button type="submit" className="btn">{copy.revoke}</button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        </article>
      ))}
    </section>
  );
}
