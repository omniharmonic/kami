"use client";
import { useActionState } from "react";
import { grantAction } from "@/app/e/[slug]/grants/actions";
import { grants } from "@/copy/grants";

type Props = { slug: string; operation: "create" | "open" | "close" | "apply"; roundId?: string; disabled?: boolean; proposals?: Array<{ id: string; title: string }> };
export function GrantForm({ slug, operation, roundId, disabled, proposals = [] }: Props) {
  const [state, action, pending] = useActionState(grantAction, { ok: false, message: "" });
  const label = operation === "create" ? grants.create : operation === "open" ? "Open applications" : operation === "close" ? "Close applications" : grants.apply;
  return <form action={action} className="stack" style={{ marginTop: 16 }}>
    <input type="hidden" name="slug" value={slug} /><input type="hidden" name="operation" value={operation} />
    {roundId && <input type="hidden" name="roundId" value={roundId} />}
    <fieldset disabled={disabled || pending} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
      {operation === "create" && <>
        <label>{grants.titleLabel}<input className="field" name="title" required minLength={3} maxLength={200} /></label>
        <label>{grants.purposeLabel}<textarea className="field" name="purposeMd" required minLength={10} maxLength={4000} rows={4} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
          <label>{grants.budgetLabel}<input className="field" name="budgetUsdc" type="number" min="0.01" step="0.01" required /></label>
          <label>{grants.deadlineLabel} (UTC)<input className="field" name="applicationDeadline" type="datetime-local" required /></label>
        </div>
      </>}
      {operation === "apply" && <label>{grants.applicationLabel}<select className="field" name="proposalId" required defaultValue=""><option value="" disabled>Select one of your proposals</option>{proposals.map(proposal => <option key={proposal.id} value={proposal.id}>{proposal.title}</option>)}</select></label>}
      <button className="btn" type="submit" style={{ justifySelf: "start" }}>{pending ? "Saving…" : label}</button>
    </fieldset>
    {state.message && <p role={state.ok ? "status" : "alert"} style={{ margin: 0, fontSize: 13 }}>{state.message}</p>}
  </form>;
}
