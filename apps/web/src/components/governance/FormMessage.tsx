import { govErrors } from "@/copy";

/**
 * Renders the `?ok=` / `?error=` a server action redirected back with, so every
 * form works with JavaScript off (arch §6.2).
 */
export function FormMessage({ ok, error, okText }: { ok?: string | null; error?: string | null; okText?: Record<string, string> }) {
  if (error) {
    return (
      <p role="alert" className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", margin: "0.75rem 0" }}>
        {govErrors[error] ?? govErrors.generic}
      </p>
    );
  }
  if (ok) {
    return (
      <p role="status" className="card" style={{ borderColor: "var(--moss)", margin: "0.75rem 0" }}>
        {okText?.[ok] ?? "Done."}
      </p>
    );
  }
  return null;
}
