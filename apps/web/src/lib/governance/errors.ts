/**
 * Governance errors carry a stable `code` that maps to a user-facing string in
 * `copy.govErrors`; server actions redirect with `?error=<code>` so forms work
 * without JavaScript.
 */
export type GovernanceErrorCode =
  | "not_found"
  | "forbidden"
  | "unauthenticated"
  | "paused"
  | "retired"
  | "invalid_transition"
  | "claim_limit"
  | "already_claimed"
  | "monthly_cap"
  | "passport_required"
  | "self_evaluation"
  | "proposer_evaluation"
  | "second_attestation_required"
  | "already_evaluated"
  | "immutable_field"
  | "invalid_spec"
  | "tier1_prediction_required"
  | "comment_window_open"
  | "invite_invalid"
  | "invite_expired"
  | "invite_email_mismatch"
  | "already_requested"
  | "not_paused"
  | "licence_required"
  | "too_many_files"
  | "file_too_large"
  | "sha_mismatch"
  | "no_files"
  | "no_claim"
  | "no_db"
  | "no_submission"
  | "hat_required"
  | "generic";

export class GovernanceError extends Error {
  constructor(
    public code: GovernanceErrorCode,
    message?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = "GovernanceError";
  }
}

export function isGovernanceError(e: unknown): e is GovernanceError {
  return e instanceof GovernanceError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "GovernanceError");
}

/** Postgres CHECK/trigger errors surface through drizzle with the message in `cause`. */
export function dbErrorMessage(e: unknown): string {
  const err = e as Error & { cause?: Error };
  return `${err?.message ?? ""}\n${err?.cause?.message ?? ""}`;
}
