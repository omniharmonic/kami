import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { claimBountyAction, evaluateAction, releaseClaimAction } from "@/actions/governance";
import { Capture } from "@/components/governance/Capture";
import { EvidenceSpecSummary, evidenceSpecLine } from "@/components/governance/EvidenceSpecSummary";
import { FormMessage } from "@/components/governance/FormMessage";
import { bountyDetail as copy, bountyStatusLabel, errors, evidence as evidenceCopy, proposalsPage, tierLabel } from "@/copy";
import { MAX_FILES_PER_SUBMISSION, MAX_FILE_BYTES } from "@/lib/evidence/storage";
import { getEntityBySlug } from "@/lib/entities";
import { requireVisibleEntity } from "@/lib/entity-access";
import { getBountyDetail, viewerIsEvaluator, type DetailSubmission } from "@/lib/governance/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const bounty = await getBountyDetail(id, null);
  return bounty ? { title: bounty.title } : { title: errors.notFound };
}

function SummaryTable({ s }: { s: DetailSubmission }) {
  const sum = s.summary;
  if (!sum) return null;
  const rows: Array<[string, string]> = [
    [evidenceCopy.summaryFields.photo_count!, String(sum.photo_count)],
    [evidenceCopy.summaryFields.exif_ok_count!, String(sum.exif_ok_count)],
    [evidenceCopy.summaryFields.gps_within_spec_count!, String(sum.gps_within_spec_count)],
    [evidenceCopy.summaryFields.in_app_capture_count!, String(sum.in_app_capture_count)],
    [evidenceCopy.summaryFields.captured_at_range!, sum.captured_at_range ? `${sum.captured_at_range.from} → ${sum.captured_at_range.to}` : "—"],
  ];
  return (
    <div className="sunken" style={{ marginTop: "0.5rem" }}>
      <p className="eyebrow" style={{ margin: "0 0 0.3rem" }}>{copy.summary}</p>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.15rem 0.75rem", fontSize: "0.9rem" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt className="faint">{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {sum.note && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.9rem" }}>
          <span className="faint">{evidenceCopy.summaryFields.note}: </span>
          {sum.note}
        </p>
      )}
      {sum.spec_check && (
        <p className="faint" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
          {copy.specCheck}: {sum.spec_check.ok ? copy.specOk : copy.specFail}
          {sum.spec_check.failures.length > 0 && (
            <ul style={{ margin: "0.2rem 0 0" }}>
              {sum.spec_check.failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </p>
      )}
    </div>
  );
}

/** `/e/[slug]/proposals/[id]` — one bounty (arch §6.1): spec, evidence spec, claims, submissions, evaluation, attestation UIDs. */
export default async function BountyPage({ params, searchParams }: Props) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const { entity } = await requireVisibleEntity(slug);
  if (!entity) notFound();
  const session = await getSession();
  const bounty = await getBountyDetail(id, session?.user.id ?? null);
  if (!bounty || bounty.entity_id !== entity.id) notFound();
  const isEvaluator = await viewerIsEvaluator(session?.user.id ?? null, entity.id);
  const back = `/e/${slug}/proposals/${id}`;
  const claimable = bounty.status === "open" || (bounty.status === "claimed" && bounty.claims.filter((c) => !c.released_at).length < bounty.claim_limit);

  return (
    <section className="section" aria-labelledby="bounty-h">
      <p style={{ margin: 0 }}>
        <Link href={`/e/${slug}/proposals`}>{copy.back}</Link>
      </p>
      <h2 id="bounty-h">{bounty.title}</h2>
      <p className="faint" style={{ margin: 0, display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        <span className="chip">{bountyStatusLabel[bounty.status]}</span>
        <span className="chip">{proposalsPage.cap(bounty.cap_usdc)}</span>
        <span className="chip">{tierLabel[bounty.verification_tier]}</span>
        {bounty.deadline && <span className="chip">{proposalsPage.deadline(bounty.deadline)}</span>}
      </p>

      <FormMessage
        ok={typeof sp.ok === "string" ? sp.ok : null}
        error={typeof sp.error === "string" ? sp.error : null}
        okText={{ claimed: copy.claimed, released: "Claim released.", evaluated: "Evaluation recorded." }}
      />

      <div className="card stack" style={{ marginTop: "0.75rem" }}>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>{copy.why}</p>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }} data-generated="ai">{bounty.why_md}</p>
        </div>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>{copy.deliverable}</p>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{bounty.deliverable_md}</p>
        </div>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>{copy.evidence}</p>
          <p style={{ margin: 0 }}>{evidenceSpecLine(bounty.evidence_spec, Number(bounty.cap_usdc))}</p>
          <EvidenceSpecSummary spec={bounty.evidence_spec} tier={bounty.verification_tier} capUsdc={Number(bounty.cap_usdc)} />
        </div>
        {bounty.prediction && (
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>{copy.prediction}</p>
            <p style={{ margin: 0 }} data-generated="ai">
              {copy.predictionLine(bounty.prediction.place_id, bounty.prediction.property, bounty.prediction.direction, bounty.prediction.window_end)}
            </p>
          </div>
        )}
        <p className="faint" style={{ margin: 0, fontSize: "0.82rem", wordBreak: "break-all" }}>
          {copy.specHash}: <code>{bounty.spec_sha256}</code>
          <br />
          {copy.postedUid}: <code>{bounty.eas_uid_posted ?? "—"}</code>
          <br />
          twin places: {bounty.twin_refs.join(", ")}
          <br />
          {bounty.approved_by_name && bounty.approved_at ? copy.approvedBy(bounty.approved_by_name, bounty.approved_at) : copy.notApproved}
        </p>
      </div>

      <h3 style={{ fontSize: "1rem", margin: "1.25rem 0 0.4rem" }}>{copy.claims}</h3>
      {bounty.claims.length === 0 ? (
        <p className="muted">{copy.claimsEmpty}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {bounty.claims.map((c) => (
            <li key={c.id}>
              {copy.claimedBy(c.name, c.claimed_at ?? "")}
              {c.released_at ? ` · ${copy.released}` : ""}
            </li>
          ))}
        </ul>
      )}

      {!session ? (
        <p style={{ marginTop: "0.75rem" }}>
          <Link href="/sign-in" className="btn">{copy.claimSignIn}</Link>
        </p>
      ) : bounty.my_claim ? (
        <div className="stack" style={{ marginTop: "0.75rem" }}>
          <p style={{ margin: 0 }}>{copy.claimed}</p>
          <Capture bountyId={bounty.id} maxFiles={MAX_FILES_PER_SUBMISSION} maxFileMb={Math.round(MAX_FILE_BYTES / (1024 * 1024))} />
          <form action={releaseClaimAction}>
            <input type="hidden" name="claim_id" value={bounty.my_claim.id} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className="btn">{copy.release}</button>
          </form>
        </div>
      ) : claimable && !entity.paused && !entity.retired ? (
        <form action={claimBountyAction} style={{ marginTop: "0.75rem" }}>
          <input type="hidden" name="bounty_id" value={bounty.id} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className="btn btn-primary">{copy.claim}</button>
        </form>
      ) : null}

      <h3 style={{ fontSize: "1rem", margin: "1.25rem 0 0.4rem" }}>{copy.submissions}</h3>
      {bounty.submissions.length === 0 ? (
        <p className="muted">{copy.submissionsEmpty}</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {bounty.submissions.map((s) => (
            <li key={s.id} className="card">
              <p className="faint" style={{ margin: 0, fontSize: "0.85rem" }}>
                {copy.submittedAt(s.submitted_at ?? "")} · {s.file_count} file{s.file_count === 1 ? "" : "s"}
              </p>
              <SummaryTable s={s} />

              <h4 style={{ fontSize: "0.95rem", margin: "0.75rem 0 0.25rem" }}>{copy.evaluation}</h4>
              {s.evaluations.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>{copy.evaluationEmpty}</p>
              ) : (
                <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
                  {s.evaluations.map((e) => (
                    <li key={e.id} style={{ marginTop: "0.4rem" }}>
                      <strong>{copy.outcomes[e.outcome] ?? e.outcome}</strong> — {e.evaluator}
                      {e.audit_of && <span className="chip" style={{ marginLeft: "0.4rem" }}>{copy.auditOf}</span>}
                      {e.notes_md && <p style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>{e.notes_md}</p>}
                      <p className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.8rem", wordBreak: "break-all" }}>
                        {copy.attestation}: <code>{e.eas_uid ?? "—"}</code>
                        {!e.attested_at && <> · {copy.attestationPending}</>}
                        {e.second_attestation_by && <> · {copy.secondAttestation}: <code>{e.second_attestation_by}</code></>}
                        {e.twin_snapshot_hash && <> · twin snapshot: <code>{e.twin_snapshot_hash}</code></>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {bounty.second_attestation_needed && s.evaluations.length === 1 && !s.evaluations[0]!.second_attestation_by && (
                <p className="muted" style={{ margin: "0.4rem 0 0" }}>{copy.secondNeeded}</p>
              )}

              {isEvaluator && !s.mine && (
                <form action={evaluateAction} className="stack" style={{ marginTop: "0.75rem" }}>
                  <input type="hidden" name="submission_id" value={s.id} />
                  <input type="hidden" name="back" value={back} />
                  <p className="muted" style={{ margin: 0 }}>{copy.evaluateIntro}</p>
                  <label>
                    <span className="eyebrow">{copy.outcome}</span>
                    <select className="field" name="outcome" required defaultValue="succeeded">
                      {Object.entries(copy.outcomes).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="eyebrow">{copy.notes}</span>
                    <textarea className="field" name="notes" style={{ minHeight: "4rem", paddingBlock: "0.5rem" }} maxLength={4000} />
                  </label>
                  <label>
                    <span className="eyebrow">{copy.twinSnapshot}</span>
                    <input className="field" name="twin_snapshot_hash" placeholder="0x…" />
                  </label>
                  <button type="submit" className="btn btn-primary">{copy.submitEvaluation}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
