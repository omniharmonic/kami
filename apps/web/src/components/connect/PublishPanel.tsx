"use client";
import { useActionState } from "react";
export type PublishState = { ok: boolean; message: string };
export function PublishPanel({ slug, action }: { slug: string; action: (previous: PublishState, form: FormData) => Promise<PublishState> }) {
  const [state, submit, pending] = useActionState(action, { ok: false, message: "" });
  return <section className="card" aria-labelledby="publish-being-h" style={{ padding: 20 }}>
    <h3 id="publish-being-h" style={{ marginTop: 0 }}>Publish this being</h3>
    <p>This page is currently a private team preview. Publishing makes the being visible in the living world.</p>
    <p className="faint">Consultation is optional and can grow over time. Publishing does not complete consultation, unpause the agent or enable payments.</p>
    <form action={submit}><input type="hidden" name="slug" value={slug} /><button className="btn btn-primary" disabled={pending || state.ok} type="submit">{pending ? "Publishing…" : state.ok ? "Published" : "Publish page"}</button></form>
    {state.message && <p role={state.ok ? "status" : "alert"}>{state.message}</p>}
  </section>;
}
