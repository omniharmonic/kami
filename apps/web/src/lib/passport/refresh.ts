/**
 * Human Passport v2 score refresh (plan T2.14, PRD §7.5 anti-gaming).
 *
 * The rule this file exists to keep: **an absent score must never read as a low
 * score.** Without `PASSPORT_API_KEY`, with no wallet, with the API down or its
 * answer unreadable, the result is `{ unavailable: true }` and **nothing is
 * written** — an existing `users.passport_score` is left exactly as it was and
 * is never zeroed. `governance/claims.ts` already refuses a gated claim when the
 * score is null, so an outage costs a person a claim, never their record.
 *
 * Scores are cached for 24 hours (`users.passport_checked_at`). The v2 scale and
 * a sensible `config.passport_min` are *verify* (docs/verify.md #10).
 */
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { isAddress } from "viem";
import type { Db, DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";

export const passportEnvSchema = z.object({
  /** Human Passport API key. Unset ⇒ every refresh answers `unavailable`. */
  PASSPORT_API_KEY: z.string().min(1).optional(),
  /** The scorer the key is scoped to. */
  PASSPORT_SCORER_ID: z.string().min(1).optional(),
  /** Override for tests / a future host change. */
  PASSPORT_API_URL: z.string().url().optional(),
  NODE_ENV: z.string().optional(),
});

export type PassportEnv = z.infer<typeof passportEnvSchema>;

export function passportEnv(source: NodeJS.ProcessEnv = process.env): PassportEnv {
  const parsed = passportEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  console.warn("[passport] env issues:", parsed.error.issues.map((i) => i.path.join(".")).join(", "));
  return passportEnvSchema.parse({ NODE_ENV: source.NODE_ENV });
}

export const DEFAULT_API_BASE = "https://api.passport.xyz";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** `GET /v2/stamps/{scorer_id}/score/{address}` (*verify* docs/verify.md #10). */
export function scoreUrl(env: PassportEnv, address: string): string {
  const base = (env.PASSPORT_API_URL ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const scorer = env.PASSPORT_SCORER_ID ?? "0";
  return `${base}/v2/stamps/${encodeURIComponent(scorer)}/score/${encodeURIComponent(address)}`;
}

export type PassportDeps = {
  env?: PassportEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (line: string) => void;
};

export type Unavailable = {
  unavailable: true;
  reason: "no_api_key" | "no_wallet" | "user_not_found" | "http_error" | "unreadable" | "network_error";
  /** whatever score is already on file, untouched */
  score: number | null;
  checked_at: string | null;
  detail?: string;
};

export type Refreshed = {
  unavailable: false;
  score: number;
  checked_at: string;
  cached: boolean;
  address: string;
};

export type RefreshResult = Refreshed | Unavailable;

function parseScore(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const raw = b.score ?? (typeof b.evidence === "object" && b.evidence !== null ? (b.evidence as Record<string, unknown>).rawScore : undefined);
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function loadUser(db: DbOrTx, userId: string) {
  const [u] = await db
    .select({ id: schema.users.id, address: schema.users.walletAddress, score: schema.users.passportScore, checkedAt: schema.users.passportCheckedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return u ?? null;
}

/**
 * Refresh one person's score. Writes only on a successful, parseable answer.
 */
export async function refreshPassportScore(db: Db, userId: string, deps: PassportDeps = {}): Promise<RefreshResult> {
  const env = deps.env ?? passportEnv();
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? ((l: string) => console.log(`[passport] ${l}`));
  const fetchImpl = deps.fetchImpl ?? fetch;

  const user = await loadUser(db, userId);
  if (!user) return { unavailable: true, reason: "user_not_found", score: null, checked_at: null };
  const existing = user.score === null || user.score === undefined ? null : Number(user.score);
  const checkedAt = user.checkedAt?.toISOString() ?? null;

  if (!env.PASSPORT_API_KEY) {
    // Never write. An unkeyed deployment has no opinion about anyone's score.
    return { unavailable: true, reason: "no_api_key", score: existing, checked_at: checkedAt };
  }
  if (!user.address || !isAddress(user.address)) {
    return { unavailable: true, reason: "no_wallet", score: existing, checked_at: checkedAt };
  }
  if (user.checkedAt && now.getTime() - user.checkedAt.getTime() < CACHE_TTL_MS && existing !== null) {
    return { unavailable: false, score: existing, checked_at: user.checkedAt.toISOString(), cached: true, address: user.address };
  }

  let res: Response;
  try {
    res = await fetchImpl(scoreUrl(env, user.address), {
      method: "GET",
      headers: { "X-API-KEY": env.PASSPORT_API_KEY, accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    log(`network error for ${userId}: ${(err as Error).message.slice(0, 120)}`);
    return { unavailable: true, reason: "network_error", score: existing, checked_at: checkedAt, detail: (err as Error).message.slice(0, 120) };
  }
  if (!res.ok) {
    log(`HTTP ${res.status} for ${userId}; the stored score is left alone`);
    return { unavailable: true, reason: "http_error", score: existing, checked_at: checkedAt, detail: `HTTP ${res.status}` };
  }
  let score: number | null;
  try {
    score = parseScore(await res.json());
  } catch {
    score = null;
  }
  if (score === null) {
    log(`unreadable score body for ${userId}; the stored score is left alone`);
    return { unavailable: true, reason: "unreadable", score: existing, checked_at: checkedAt };
  }

  await db.update(schema.users).set({ passportScore: String(score), passportCheckedAt: now, updatedAt: now }).where(eq(schema.users.id, userId));
  return { unavailable: false, score, checked_at: now.toISOString(), cached: false, address: user.address };
}

/** Users with a claim or a payout in the last `days` days — the daily refresh set. */
export async function usersDueForRefresh(db: Db, opts: { now?: Date; days?: number; limit?: number } = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 90;
  const since = new Date(now.getTime() - days * 86_400_000);
  const claimants = await db
    .selectDistinct({ id: schema.claims.userId })
    .from(schema.claims)
    .where(and(isNotNull(schema.claims.userId), gte(schema.claims.claimedAt, since)));
  const payees = await db
    .selectDistinct({ id: schema.payouts.recipientUserId })
    .from(schema.payouts)
    .where(and(isNotNull(schema.payouts.recipientUserId), gte(schema.payouts.executedAt, since)));
  const ids = new Set<string>();
  for (const r of [...claimants, ...payees]) if (r.id) ids.add(r.id);
  const out = [...ids].sort();
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export type RunResult = {
  considered: number;
  refreshed: number;
  cached: number;
  unavailable: Array<{ user_id: string; reason: Unavailable["reason"] }>;
  /** true when the whole run was a no-op because no key is configured */
  no_api_key: boolean;
};

/** The daily job (`/api/cron/passport`). */
export async function runPassportRefresh(db: Db, deps: PassportDeps = {}, opts: { days?: number; limit?: number } = {}): Promise<RunResult> {
  const env = deps.env ?? passportEnv();
  const now = (deps.now ?? (() => new Date()))();
  const ids = await usersDueForRefresh(db, { now, ...opts });
  const out: RunResult = { considered: ids.length, refreshed: 0, cached: 0, unavailable: [], no_api_key: !env.PASSPORT_API_KEY };
  if (!env.PASSPORT_API_KEY) {
    // One line, once — not one per user, and not a single write.
    (deps.log ?? console.log)("[passport] no PASSPORT_API_KEY; scores left untouched");
    return out;
  }
  for (const id of ids) {
    const r = await refreshPassportScore(db, id, { ...deps, env, now: () => now });
    if (r.unavailable) out.unavailable.push({ user_id: id, reason: r.reason });
    else if (r.cached) out.cached += 1;
    else out.refreshed += 1;
  }
  return out;
}

/** What the UI shows: a number, or "unverified" — never a zero we invented. */
export async function passportStatus(db: DbOrTx, userId: string): Promise<{ score: number | null; checked_at: string | null; label: "unverified" | "checked" }> {
  const u = await loadUser(db, userId);
  const score = u?.score === null || u?.score === undefined ? null : Number(u.score);
  return { score, checked_at: u?.checkedAt?.toISOString() ?? null, label: score === null ? "unverified" : "checked" };
}
