/**
 * Tier-4 follow-ups (PRD §7.2: "deposit on completion, balance on a 6–12-month
 * follow-up"). `governance/evaluations.ts` writes each one into
 * `config.tier4_followups` keyed by bounty id — schema gap #3, which is
 * deliberately not fixed here — carrying `{submission_id, evaluation_id,
 * deposit_usdc, balance_usdc, follow_up_due, followed_up_at}`.
 *
 * This daily job finds the ones whose `follow_up_due` has passed and that
 * nobody has followed up, notifies an evaluator, and records a
 * `tier4_followup_due` event. It never evaluates and never pays: the balance
 * moves only when an evaluator files the second attestation
 * (`recordTier4FollowUp`) and two guardians sign the payout.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { getConfig, setConfig } from "@/lib/jobs/common";
import type { TreasuryDeps } from "@/lib/treasury/deps";
import { emailForUser, emailsForRole, stewardEmails } from "@/lib/treasury/notify";

export const TIER4_KEY = "tier4_followups";
/** Don't nag: one reminder a week per follow-up. */
export const RENOTIFY_DAYS = 7;

export type Tier4Entry = {
  submission_id: string;
  evaluation_id: string;
  deposit_usdc?: number;
  balance_usdc: number;
  deposit_pct?: number;
  follow_up_due: string;
  followed_up_at: string | null;
  created_at?: string;
  /** written by this job */
  followup_notified_at?: string | null;
};

export type DueFollowUp = {
  bounty_id: string;
  entity_id: string;
  entity_slug: string;
  entity_name: string;
  bounty_title: string;
  submission_id: string;
  evaluation_id: string;
  balance_usdc: number;
  follow_up_due: string;
  days_overdue: number;
  notified: boolean;
  recipients: string[];
};

export type Tier4Result = { considered: number; due: DueFollowUp[]; notified: number; skipped: number };

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Entries past their date and not yet followed up, joined to their entity.
 */
export async function dueFollowUps(db: Db, now: Date, opts: { slug?: string } = {}): Promise<{ entries: Record<string, Tier4Entry>; due: DueFollowUp[] }> {
  const entries = (await getConfig<Record<string, Tier4Entry>>(db, TIER4_KEY)) ?? {};
  const overdue = Object.entries(entries).filter(([, v]) => {
    if (!v || typeof v.follow_up_due !== "string" || v.followed_up_at) return false;
    const t = Date.parse(`${v.follow_up_due}T00:00:00Z`);
    return Number.isFinite(t) && t <= now.getTime();
  });
  if (overdue.length === 0) return { entries, due: [] };

  const rows = await db
    .select({ bounty: schema.bounties, entity: schema.entities })
    .from(schema.bounties)
    .innerJoin(schema.entities, eq(schema.entities.id, schema.bounties.entityId))
    .where(inArray(schema.bounties.id, overdue.map(([id]) => id)));
  const byId = new Map(rows.map((r) => [r.bounty.id, r]));

  const due: DueFollowUp[] = [];
  for (const [bountyId, v] of overdue) {
    const row = byId.get(bountyId);
    if (!row) continue;
    if (opts.slug && row.entity.slug !== opts.slug) continue;
    if (row.entity.retiredAt) continue;
    due.push({
      bounty_id: bountyId,
      entity_id: row.entity.id,
      entity_slug: row.entity.slug,
      entity_name: row.entity.name,
      bounty_title: row.bounty.title,
      submission_id: v.submission_id,
      evaluation_id: v.evaluation_id,
      balance_usdc: Number(v.balance_usdc ?? 0),
      follow_up_due: v.follow_up_due,
      days_overdue: daysBetween(now, new Date(`${v.follow_up_due}T00:00:00Z`)),
      notified: false,
      recipients: [],
    });
  }
  return { entries, due };
}

/** Who to tell: the evaluator who filed the deposit outcome, else the entity's evaluators, else a steward. */
async function recipientsFor(db: Db, entityId: string, evaluationId: string): Promise<string[]> {
  const [ev] = await db.select({ evaluatorId: schema.evaluations.evaluatorId }).from(schema.evaluations).where(eq(schema.evaluations.id, evaluationId)).limit(1);
  if (ev?.evaluatorId) {
    const email = await emailForUser(db, ev.evaluatorId);
    if (email) return [email];
  }
  const evaluators = await emailsForRole(db, entityId, "evaluator");
  if (evaluators.length) return evaluators;
  return stewardEmails(db, entityId);
}

export const tier4Copy = {
  subject: (name: string, title: string) => `${name}: a tier-4 follow-up is due — "${title}"`,
  body: (d: DueFollowUp) =>
    [
      `The six-to-twelve month follow-up on "${d.bounty_title}" for ${d.entity_name} came due on ${d.follow_up_due} (${d.days_overdue} day${d.days_overdue === 1 ? "" : "s"} ago).`,
      "",
      `An evaluator needs to look at what actually survived and file a second outcome. Until then the balance of $${d.balance_usdc.toFixed(2)} USDC stays unpaid — that is the point of a tier-4 bounty, not a delay.`,
      "",
      `Submission: ${d.submission_id}`,
      `First evaluation: ${d.evaluation_id}`,
      "",
      "If the outcome cannot be verified, say so: an honest 'unverifiable' is a valid answer and is recorded as one.",
    ].join("\n"),
} as const;

/** The daily job (`/api/cron/tier4-followup`). */
export async function runTier4FollowUps(db: Db, deps: TreasuryDeps, opts: { slug?: string } = {}): Promise<Tier4Result> {
  const now = deps.now();
  const { entries, due } = await dueFollowUps(db, now, opts);
  const result: Tier4Result = { considered: Object.keys(entries).length, due, notified: 0, skipped: 0 };
  if (due.length === 0) return result;

  let changed = false;
  for (const d of due) {
    const entry = entries[d.bounty_id];
    const last = entry?.followup_notified_at ? Date.parse(entry.followup_notified_at) : NaN;
    if (Number.isFinite(last) && now.getTime() - last < RENOTIFY_DAYS * 86_400_000) {
      result.skipped += 1;
      continue;
    }
    d.recipients = await recipientsFor(db, d.entity_id, d.evaluation_id);
    try {
      await deps.notify.send({ to: d.recipients, subject: tier4Copy.subject(d.entity_name, d.bounty_title), text: tier4Copy.body(d) });
      d.notified = true;
      result.notified += 1;
    } catch (err) {
      deps.log(`tier-4 follow-up notice failed for ${d.bounty_id}: ${(err as Error).message}`);
    }
    if (entry) {
      entries[d.bounty_id] = { ...entry, followup_notified_at: now.toISOString() };
      changed = true;
    }
    await appendEntityEvent(db, {
      entity_id: d.entity_id,
      actor: "tier4-followup",
      kind: "tier4_followup_due",
      payload: {
        bounty_id: d.bounty_id,
        submission_id: d.submission_id,
        evaluation_id: d.evaluation_id,
        balance_usdc: d.balance_usdc.toFixed(2),
        follow_up_due: d.follow_up_due,
        days_overdue: d.days_overdue,
        notified: d.notified,
        recipients: d.recipients.length,
      },
      at: now,
    });
  }
  if (changed) await setConfig(db, TIER4_KEY, entries, now);
  return result;
}
