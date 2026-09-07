"use client";
import { sensingCopy as c } from "@/copy/sensing";
import { useActionState } from "react";
import type { SensingStatus } from "@/lib/connect/sensing";
type State = {
    message: string;
    ok: boolean;
    warnings?: string[];
    warningHash?: string;
};
export function SensingPanel({ slug, status, mayManage, action }: {
    slug: string;
    status: SensingStatus;
    mayManage: boolean;
    action: (previous: State, form: FormData) => Promise<State>;
}) {
    const [result, submit, pending] = useActionState(action, { message: "", ok: false });
    return <section className="section" aria-labelledby="sensing-heading">
  <h3 id="sensing-heading">{c.heading}</h3>
  <p>{status.valid ? c.summary(status.places.length, status.needs.length) : c.unavailable} · {c.binding} {status.version ?? c.notConfigured}: {status.review.replaceAll("_", " ")}</p>
  <p className="muted">{c.explanation}</p>
  <details><summary>{c.review}</summary>
   <ul>{status.places.map(p => <li key={p.id}>{p.id} — {p.role.replaceAll("_", " ")}</li>)}</ul>
   <ul>{status.needs.map((n, i) => <li key={i}><strong>{n.need}</strong>: {n.property} · {n.aggregation}<br />{n.places.length ? n.places.join(", ") : c.watershed}</li>)}</ul>
  </details>
  <p>{status.snapshot ? <>{c.latest} <time dateTime={status.snapshot.asOf}>{status.snapshot.asOf}</time> · {status.snapshot.mood}</> : c.noSnapshot}</p>
  {mayManage ? <form action={submit} className="stack">
   <input type="hidden" name="slug" value={slug}/><input type="hidden" name="version" value={status.version ?? ""}/><input type="hidden" name="hash" value={status.hash ?? ""}/>
   {status.review === "pending_review" && status.valid ? <><input type="hidden" name="operation" value="approve"/>
   {result.warnings?.length ? <div className="sunken"><p>{c.warnings}</p><ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul><input type="hidden" name="warning_hash" value={result.warningHash ?? ""}/><label><input type="checkbox" required name="warnings_reviewed" value="yes"/> {c.acknowledgeWarnings}</label></div> : null}<label><input type="checkbox" name="reviewed" value="yes" required/> {c.acknowledge}</label><button className="btn" disabled={pending}>{pending ? c.validating : c.approve}</button></> : status.review === "approved" ? <><input type="hidden" name="operation" value="refresh"/><button className="btn" disabled={pending}>{pending ? c.refreshing : status.snapshot ? c.refresh : c.compute}</button></> : <p>{c.invalid}</p>}
  </form> : <p>{c.roleRequired}</p>}
  {result.message ? <p role="status" className={result.ok ? "notice" : "sunken"}>{result.message}</p> : null}
  <p className="faint">{c.preservation}</p>
 </section>;
}
