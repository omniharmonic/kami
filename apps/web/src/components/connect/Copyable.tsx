"use client";

/**
 * A value someone has to get into another program without typos: an endpoint,
 * a slug, a header, a token. Selectable text first — the copy button is an
 * affordance, not the only way in — and `navigator.clipboard` is absent often
 * enough (insecure origin, Firefox without permission) that a failure just
 * leaves the text selected rather than claiming success.
 */
import { useId, useRef, useState } from "react";
import { connect as copy } from "@/copy";

type Props = {
  label: string;
  value: string;
  /** render as a block rather than a single line */
  block?: boolean;
  /** a hint under the value */
  hint?: string | null;
  testId?: string;
};

export function Copyable({ label, value, block = false, hint = null, testId }: Props) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  const id = useId();

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const node = ref.current;
      if (node && typeof window !== "undefined") {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  return (
    <div className="stack" style={{ marginTop: "0.6rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
        <span className="eyebrow" id={id}>{label}</span>
        <button type="button" className="btn" style={{ minHeight: "2rem", fontSize: "0.85rem" }} onClick={onCopy}>
          {copied ? copy.token.copied : copy.token.copy}
        </button>
      </div>
      <code
        ref={ref as React.Ref<HTMLElement>}
        aria-labelledby={id}
        data-testid={testId}
        className="sunken"
        style={{
          display: "block",
          fontSize: "0.82rem",
          wordBreak: "break-all",
          whiteSpace: block ? "pre-wrap" : "normal",
          margin: 0,
          maxHeight: block ? "24rem" : undefined,
          overflow: block ? "auto" : undefined,
        }}
      >
        {value}
      </code>
      {hint ? <p className="faint" style={{ margin: 0, fontSize: "0.82rem" }}>{hint}</p> : null}
    </div>
  );
}
