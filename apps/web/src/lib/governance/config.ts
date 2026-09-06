/**
 * `config` table access with the governance defaults from PRD §7 / arch §8.3.
 * Values are JSON; readers coerce and fall back so a missing row never throws.
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";

export const CONFIG_DEFAULTS = {
  /** guardians needed to open a draft (1 in phase 2) */
  bounty_approvals_required: 1,
  /** per person, per calendar month, across all entities (PRD §7.1 caps) */
  per_person_monthly_cap_usdc: 300,
  /** claims above this need a Passport score (arch §8.3) */
  passport_gate_usd: 50,
  /** Human Passport minimum (*verify* scorer scale — docs/verify.md #10) */
  passport_min: 20,
  /** retro bonus pool as a % of the quarter's net donations */
  retro_pct: 10,
  /** fraction of tier-2 evaluations sampled for a second-evaluator audit */
  audit_rate: 0.1,
  /** tier-4: share paid on completion; the balance follows the follow-up */
  tier4_deposit_pct: 50,
  /** tier-4 follow-up window in months (6–12, PRD §7.2) */
  tier4_follow_up_months: 6,
  /** hours in which two guardians must both request a resume */
  resume_window_hours: 24,
  /** public comment window on a strategy memo, in days */
  strategy_comment_days: 14,
  /** guardian invite validity, in days */
  invite_days: 7,
} as const;

export type ConfigKey = keyof typeof CONFIG_DEFAULTS;

export async function getConfigValue<T>(db: DbOrTx, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(schema.config).where(eq(schema.config.key, key)).limit(1);
  if (!row) return fallback;
  return row.value as T;
}

export async function getConfigNumber(db: DbOrTx, key: ConfigKey | string, fallback?: number): Promise<number> {
  const fb = fallback ?? (CONFIG_DEFAULTS as Record<string, number>)[key] ?? 0;
  const v = await getConfigValue<unknown>(db, key, fb);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fb;
}

export async function setConfigValue(db: DbOrTx, key: string, value: unknown): Promise<void> {
  await db
    .insert(schema.config)
    .values({ key, value: value as object, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.config.key, set: { value: value as object, updatedAt: new Date() } });
}
