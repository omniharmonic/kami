/**
 * The evidence licence shown at upload (PRD §13 #7). The text lives in the
 * copy module; this module versions it and validates acceptance.
 */
import { evidence as copy } from "@/copy";
import { GovernanceError } from "@/lib/governance/errors";

export const EVIDENCE_LICENCE_VERSION = "evidence-licence/1";

export function evidenceLicenceText(): readonly string[] {
  return copy.licence;
}

/** Returns the acceptance instant or throws `licence_required`. */
export function requireLicenceAccepted(input: { licence_accepted?: boolean | string | null; licence_accepted_at?: string | Date | null }, now = new Date()): Date {
  const flag = input.licence_accepted === true || input.licence_accepted === "on" || input.licence_accepted === "true";
  if (input.licence_accepted_at) {
    const d = input.licence_accepted_at instanceof Date ? input.licence_accepted_at : new Date(input.licence_accepted_at);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= now.getTime() + 60_000) return d;
  }
  if (flag) return now;
  throw new GovernanceError("licence_required");
}
