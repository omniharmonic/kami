import { summon } from "@/lib/summon/copy";

const OK: Record<string, string> = {
  started: "Draft started.",
  saved: "Saved.",
  proposed: "Here is what the platform proposes.",
  deleted: "Draft discarded.",
  summoned: summon.review.created,
  consultation_done: "Consultation marked done. The page can publish.",
};

/** The `?ok=` / `?error=` a summon action redirected back with (arch §6.2). */
export function SummonMessage({ ok, error }: { ok?: string | null; error?: string | null }) {
  if (error) {
    return (
      <p role="alert" className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", margin: "0.75rem 0" }}>
        {summon.errors[error] ?? summon.errors.generic}
      </p>
    );
  }
  if (ok) {
    return (
      <p role="status" className="card" style={{ borderColor: "var(--moss)", margin: "0.75rem 0" }}>
        {OK[ok] ?? "Done."}
      </p>
    );
  }
  return null;
}

export function firstParam(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const v = params[key];
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;
}
