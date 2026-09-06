import Link from "next/link";
import { STEP_TITLES, summon } from "@/lib/summon/copy";

/** Five steps and a review, with the ones already saved linked. Phone-first: wraps, 44 px targets. */
export function Progress({ draftId, current, reached }: { draftId: string; current: number | "review" | "done"; reached: number }) {
  const steps = [1, 2, 3, 4, 5, 6];
  return (
    <nav aria-label="Summon progress" className="section" style={{ marginBottom: "1rem" }}>
      <ol style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", listStyle: "none", padding: 0, margin: 0 }}>
        {steps.map((n) => {
          const label = n === 6 ? summon.review.title : STEP_TITLES[n]!;
          const isCurrent = current === n || (current === "review" && n === 6);
          const visitable = n <= reached && current !== "done";
          const body = (
            <span
              className="chip"
              style={{
                minHeight: "var(--tap)",
                paddingInline: "0.75rem",
                ...(isCurrent ? { borderColor: "var(--accent)", background: "var(--accent-soft)", fontWeight: 600 } : {}),
                ...(n > reached ? { color: "var(--ink-faint)" } : {}),
              }}
            >
              <span aria-hidden="true">{n === 6 ? "✓" : n}</span> {label}
            </span>
          );
          return (
            <li key={n}>
              {visitable && !isCurrent ? (
                <Link href={`/summon/${draftId}/${n === 6 ? "review" : n}`} style={{ textDecoration: "none" }} aria-current={undefined}>
                  {body}
                </Link>
              ) : (
                <span aria-current={isCurrent ? "step" : undefined}>{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
