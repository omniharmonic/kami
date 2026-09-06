/**
 * Server-rendered half of the guardian sign screen: bounty, evidence summary
 * and thumbnails, evaluation outcome and notes, attestation UID, amount,
 * recipient handle, Safe address, nonce. Numbers shown here come from the
 * proposal row and the Transaction Service, never from the model.
 */
import { treasuryCopy } from "@/lib/treasury/copy";
import type { ProposalPageView } from "@/lib/treasury/proposal-page";

function EvidenceThumb({ file }: { file: ProposalPageView["evidence"][number] }) {
  const isImage = (file.mime ?? "").startsWith("image/");
  return (
    <li className="card" style={{ fontSize: "0.85rem", maxWidth: "16rem" }}>
      {isImage && file.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.url} alt="" width={240} height={180} style={{ width: "100%", height: "auto", borderRadius: "0.25rem" }} loading="lazy" />
      ) : (
        <p className="muted" style={{ margin: 0 }}>{file.mime ?? "file"}</p>
      )}
      <p className="faint" style={{ margin: "0.3rem 0 0", wordBreak: "break-all" }}>
        {file.captured_at ? <time dateTime={file.captured_at}>{file.captured_at}</time> : "no capture time"}
        {file.in_app_capture ? " · in-app capture" : " · uploaded"}
        <br />
        sha256: <code>{file.sha256.slice(0, 16)}…</code>
      </p>
    </li>
  );
}

export function ProposalDetail({ view }: { view: ProposalPageView }) {
  const c = treasuryCopy.page;
  const summary = view.submission?.evidence_summary;
  return (
    <div className="stack">
      <p className="eyebrow" style={{ margin: 0 }}>{c.eyebrow}</p>
      <h1 style={{ margin: 0 }}>{c.title}</h1>
      <p className="muted" style={{ margin: 0 }}>{c.intro(view.entity.name)}</p>

      <section className="card stack" aria-labelledby="prop-amount-h">
        <h2 id="prop-amount-h" style={{ fontSize: "1rem", margin: 0 }}>{c.amount}</h2>
        <p style={{ margin: 0 }}>
          <strong>{view.amount_usdc ?? "—"} USDC</strong> → {view.recipient?.handle ?? "unknown"}
        </p>
        <p className="faint" style={{ margin: 0, wordBreak: "break-all" }}>
          {c.recipient}: <code>{view.recipient?.address ?? view.to ?? "—"}</code>
          <br />
          {c.safe}: <code>{view.entity.safe_address ?? "—"}</code> · {c.nonce} <code>{view.nonce ?? "—"}</code>
          <br />
          <code>{view.safe_tx_hash}</code>
          <br />
          {c.status[view.status] ?? view.status}
          {view.proposed_at && <> · {c.proposedAt} <time dateTime={view.proposed_at}>{view.proposed_at}</time></>}
        </p>
      </section>

      {view.bounty && (
        <section className="card stack" aria-labelledby="prop-bounty-h">
          <h2 id="prop-bounty-h" style={{ fontSize: "1rem", margin: 0 }}>{c.bounty}</h2>
          <p style={{ margin: 0 }}><strong>{view.bounty.title}</strong></p>
          <p className="faint" style={{ margin: 0 }}>cap {view.bounty.cap_usdc} USDC · verification tier {view.bounty.verification_tier}</p>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{view.bounty.deliverable_md}</p>
        </section>
      )}

      <section className="card stack" aria-labelledby="prop-evidence-h">
        <h2 id="prop-evidence-h" style={{ fontSize: "1rem", margin: 0 }}>{c.evidence}</h2>
        {view.submission?.note_md && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{view.submission.note_md}</p>}
        {summary != null && (
          <pre className="sunken" style={{ margin: 0, overflowX: "auto", fontSize: "0.8rem" }}>{JSON.stringify(summary, null, 2)}</pre>
        )}
        {view.evidence.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{c.evidenceNone}</p>
        ) : (
          <ul className="stack" style={{ listStyle: "none", display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: 0, margin: 0 }}>
            {view.evidence.map((f) => <EvidenceThumb key={f.id} file={f} />)}
          </ul>
        )}
      </section>

      <section className="card stack" aria-labelledby="prop-eval-h">
        <h2 id="prop-eval-h" style={{ fontSize: "1rem", margin: 0 }}>{c.evaluation}</h2>
        <p style={{ margin: 0 }}>
          <strong>{view.evaluation?.outcome ?? "not evaluated"}</strong>
          {view.evaluation?.evaluator && <span className="faint"> · {view.evaluation.evaluator}</span>}
        </p>
        {view.evaluation?.notes_md && (
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            <span className="eyebrow">{c.evaluationNotes}</span>
            <br />
            {view.evaluation.notes_md}
          </p>
        )}
        <p className="faint" style={{ margin: 0, wordBreak: "break-all" }}>
          {c.attestation}: <code>{view.outcome_uid ?? "—"}</code>
        </p>
      </section>
    </div>
  );
}
