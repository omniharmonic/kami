"use client";

import { useActionState, useState } from "react";
import { auth as copy } from "@/copy";
import { requestMagicLink, type SignInState } from "./actions";

const initial: SignInState = { ok: false, message: null };

export function SignInForm() {
  const [state, action, pending] = useActionState(requestMagicLink, initial);
  const [ageOk, setAgeOk] = useState(false);
  return (
    <form action={action} className="stack card" aria-describedby="signin-intro" noValidate>
      <p id="signin-intro" className="muted" style={{ margin: 0 }}>{copy.intro}</p>
      <label htmlFor="email" style={{ display: "block" }}>
        {copy.email}
        <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required className="field" style={{ marginTop: "0.3rem" }} />
      </label>
      <label className="check">
        <input type="checkbox" name="age_gate" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} required />
        <span>{copy.ageGate}</span>
      </label>
      {!ageOk && <p className="faint" style={{ margin: 0, fontSize: "0.85rem" }}>{copy.ageGateRefused}</p>}
      <button type="submit" className="btn btn-primary" disabled={!ageOk || pending} aria-disabled={!ageOk || pending}>
        {pending ? "Sending…" : copy.submit}
      </button>
      {state.message && (
        <p role="status" aria-live="polite" style={{ margin: 0, color: state.ok ? "var(--moss)" : "var(--danger)" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
