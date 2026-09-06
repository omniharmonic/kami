"use client";

/**
 * The amount field. Deliberately dull (PRD §13 #2):
 *
 *  - no `defaultValue` and no pre-pressed suggestion — nothing is chosen for
 *    the donor;
 *  - no recurring checkbox exists, in this file or anywhere else;
 *  - no countdown, no goal bar, no progress toward a target;
 *  - the fee is stated above the button, in numbers, before anyone clicks.
 */
import { useCallback, useState } from "react";
import { donateCopy } from "@/lib/donations/copy";

export type DonateFormProps = {
  slug: string;
  minUsd: number;
  maxUsd: number;
  /** false when Stripe or the Safe is not configured; the direct route still works */
  cardEnabled: boolean;
  /** test seam */
  submitImpl?: (body: { slug: string; amount_usd: number }) => Promise<{ url?: string; detail?: string }>;
  /** test seam */
  navigate?: (url: string) => void;
};

async function postDonate(body: { slug: string; amount_usd: number }): Promise<{ url?: string; detail?: string }> {
  const res = await fetch("/api/donate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json().catch(() => ({}))) as { url?: string; detail?: string };
}

export function DonateForm({ slug, minUsd, maxUsd, cardEnabled, submitImpl, navigate }: DonateFormProps) {
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) {
        setPhase("error");
        setMessage(donateCopy.amount.invalid);
        return;
      }
      setPhase("submitting");
      setMessage(null);
      try {
        const body = await (submitImpl ?? postDonate)({ slug, amount_usd: value });
        if (body.url) {
          (navigate ?? ((u: string) => { window.location.href = u; }))(body.url);
          return;
        }
        setPhase("error");
        setMessage(body.detail ?? donateCopy.amount.failed);
      } catch {
        setPhase("error");
        setMessage(donateCopy.amount.failed);
      }
    },
    [amount, navigate, slug, submitImpl],
  );

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label htmlFor="donate-amount">{donateCopy.amount.label}</label>
      <input
        id="donate-amount"
        name="amount_usd"
        type="number"
        inputMode="decimal"
        min={minUsd}
        max={maxUsd}
        step="0.01"
        placeholder={donateCopy.amount.placeholder}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={!cardEnabled}
        style={{ maxWidth: "12rem" }}
      />
      <p className="faint" style={{ margin: 0 }}>{donateCopy.amount.minMax(minUsd, maxUsd)}</p>
      <div className="stack" style={{ flexDirection: "row", gap: "0.5rem", flexWrap: "wrap" }}>
        {donateCopy.amount.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="btn tap"
            aria-pressed={false}
            onClick={() => setAmount(String(s))}
            disabled={!cardEnabled}
          >
            ${s}
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: 0 }}>{donateCopy.amount.suggestionsNote}</p>
      <p style={{ margin: 0 }}>{donateCopy.fees.card}</p>
      <p className="muted" style={{ margin: 0 }}>{donateCopy.amount.oneTime}</p>
      <button type="submit" className="btn btn-primary tap" disabled={!cardEnabled || phase === "submitting"} aria-busy={phase === "submitting"}>
        {phase === "submitting" ? donateCopy.amount.submitting : donateCopy.amount.submit}
      </button>
      {message && (
        <p role="status" className="muted" style={{ margin: 0 }}>
          {message}
        </p>
      )}
    </form>
  );
}
