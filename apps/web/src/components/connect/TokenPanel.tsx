"use client";

/**
 * Mint, show once, rotate.
 *
 * Three deliberate frictions, because each of these actions has a consequence
 * someone can only reverse by doing work:
 *
 * 1. **Minting is a button, never a page load.** Nothing about opening this
 *    page creates a credential.
 * 2. **The value is shown exactly once**, and only in the reply to the click
 *    that created it. It is not in the page's own HTML, not in a URL, and not
 *    recoverable: the platform stores a sha256. "Hide" drops it from React
 *    state and it is gone from this browser.
 * 3. **Rotating states its consequence before it is possible.** The warning is
 *    rendered, and the confirmation ticked, before the submit button exists —
 *    and the server action refuses a rotation that arrives without it, so the
 *    guarantee does not depend on this component.
 */
import { useActionState, useState } from "react";
import { connect as copy, humanDuration } from "@/copy";
import type { TokenState } from "@/lib/connect/token";
import { Copyable } from "./Copyable";

export type MintFormState = {
  ok: boolean;
  /** present only in the reply to the click that minted it */
  token?: string | null;
  replaced?: boolean;
  error?: string | null;
};

export const EMPTY_MINT_STATE: MintFormState = { ok: false, token: null, error: null };

type Props = {
  token: TokenState;
  mayMint: boolean;
  slug: string;
  tokenVar: string;
  slugVar: string;
  action: (prev: MintFormState, formData: FormData) => Promise<MintFormState>;
};

export function TokenPanel({ token, mayMint, slug, tokenVar, slugVar, action }: Props) {
  const [state, formAction, pending] = useActionState(action, EMPTY_MINT_STATE);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const showToken = Boolean(state.token) && !dismissed;

  return (
    <section className="card" aria-labelledby="token-h" data-testid="token-panel">
      <h3 id="token-h" style={{ marginTop: 0 }}>{copy.token.heading}</h3>
      <p className="muted" style={{ marginTop: 0 }}>{copy.token.what}</p>

      {token.exists ? (
        <dl className="sunken" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }} data-testid="token-facts">
          <dt className="eyebrow">{copy.token.prefixLabel}</dt>
          <dd style={{ margin: "0 0 0.4rem" }}><code>{token.prefix}…</code></dd>
          <dt className="eyebrow">{copy.token.fingerprintLabel}</dt>
          <dd style={{ margin: "0 0 0.4rem" }}>
            <code>{token.fingerprint}</code> <span className="faint">{copy.token.fingerprintWhat}</span>
          </dd>
          {token.minted_at ? (
            <>
              <dt className="eyebrow">{copy.token.existsHeading}</dt>
              <dd style={{ margin: 0 }}>
                {copy.token.mintedAt(token.minted_at)} {token.age_s === null ? "" : copy.token.age(humanDuration(token.age_s))}{" "}
                {token.rotated ? copy.token.wasRotated : ""}
              </dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="sunken" data-testid="token-none">{copy.token.noneYet}</p>
      )}

      {showToken ? (
        <div className="card" style={{ borderColor: "var(--accent)" }} role="status" data-testid="token-once">
          <h4 style={{ marginTop: 0 }}>{copy.token.shownOnceHeading}</h4>
          <p className="muted" style={{ marginTop: 0 }}>{copy.token.shownOnce}</p>
          <Copyable label={tokenVar} value={state.token!} testId="token-value" />
          <p className="faint" style={{ fontSize: "0.82rem" }}>{copy.token.envHint(tokenVar, slugVar, slug)}</p>
          <button type="button" className="btn" onClick={() => setDismissed(true)}>{copy.token.hide}</button>
        </div>
      ) : null}
      {state.token && dismissed ? (
        <p className="sunken" data-testid="token-hidden">{copy.token.hiddenAgain}</p>
      ) : null}
      {state.error ? (
        <p className="sunken" role="alert" data-testid="token-error">{copy.errors[state.error] ?? copy.errors.generic}</p>
      ) : null}

      {!mayMint ? (
        <p className="faint" data-testid="token-cannot-mint">{copy.token.cannotMint}</p>
      ) : !token.exists ? (
        <form action={formAction}>
          <input type="hidden" name="slug" value={slug} />
          <p className="muted">{copy.token.mintConsequence}</p>
          <button className="btn btn-primary" type="submit" disabled={pending} data-testid="mint">{copy.token.mint}</button>
        </form>
      ) : !confirming ? (
        <button type="button" className="btn" onClick={() => setConfirming(true)} data-testid="rotate-start">{copy.token.rotate}</button>
      ) : (
        <form action={formAction} data-testid="rotate-form">
          <input type="hidden" name="slug" value={slug} />
          <div className="sunken" style={{ borderLeft: "4px solid var(--warm)" }}>
            <strong>{copy.token.rotateWarningHeading}</strong>
            <p style={{ margin: "0.4rem 0 0" }}>{copy.token.rotateWarning}</p>
          </div>
          <label className="check" style={{ marginTop: "0.6rem" }}>
            <input type="checkbox" name="confirm" value="yes" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{copy.token.rotateConfirm}</span>
          </label>
          <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit" disabled={!confirmed || pending} data-testid="rotate-go">{copy.token.rotateGo}</button>
            <button className="btn" type="button" onClick={() => { setConfirming(false); setConfirmed(false); }}>{copy.token.rotateCancel}</button>
          </p>
        </form>
      )}
    </section>
  );
}
