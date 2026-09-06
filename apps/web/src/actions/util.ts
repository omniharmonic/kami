/**
 * Shared plumbing for the governance server actions (arch §6.2: every
 * authenticated mutation is a server action). Forms work without JavaScript:
 * an action redirects back to its page with `?ok=<kind>` or `?error=<code>`,
 * and the page renders the matching string from `copy.govErrors`.
 */
import { redirect } from "next/navigation";
import { getDb, type Db } from "@/db/client";
import { GovernanceError, isGovernanceError, type GovernanceErrorCode } from "@/lib/governance/errors";
import { AuthError, getSession, type SessionUser } from "@/lib/session";

export async function requireUserOrThrow(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new GovernanceError("unauthenticated");
  return s.user;
}

export function dbOrThrow(): Db {
  const db = getDb();
  if (!db) throw new GovernanceError("no_db");
  return db;
}

export function errorCodeOf(err: unknown): GovernanceErrorCode {
  if (isGovernanceError(err)) return err.code;
  if (err instanceof AuthError) return err.status === 401 ? "unauthenticated" : "forbidden";
  const msg = (err as Error)?.message ?? "";
  const cause = ((err as { cause?: Error })?.cause?.message ?? "") + msg;
  if (/evaluations_evaluator_not_claimant/.test(cause)) return "self_evaluation";
  if (/evaluations_evaluator_not_proposer/.test(cause)) return "proposer_evaluation";
  if (/evaluations_second_attestor_independent/.test(cause)) return "second_attestation_required";
  console.warn("[actions] unexpected error:", msg, (err as { cause?: Error })?.cause?.message ?? "");
  return "generic";
}

export function withParam(path: string, key: string, value: string): string {
  const [base, query] = path.split("?");
  const params = new URLSearchParams(query ?? "");
  params.delete("ok");
  params.delete("error");
  params.set(key, value);
  return `${base}?${params.toString()}`;
}

/** Run `fn`; redirect to `path?ok=…` on success and `path?error=<code>` on failure. */
export async function actionRedirect(path: string, ok: string, fn: () => Promise<unknown>): Promise<never> {
  let target: string;
  try {
    await fn();
    target = withParam(path, "ok", ok);
  } catch (err) {
    target = withParam(path, "error", errorCodeOf(err));
  }
  redirect(target);
}

export function formString(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function formNumber(fd: FormData, key: string): number | undefined {
  const v = formString(fd, key);
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function formBool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}
