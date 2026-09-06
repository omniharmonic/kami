/**
 * Finishing the retire flow (PRD §13 #6, plan T2.16). `governance/pause.ts`
 * owns the decision — two guardians, `retire_requested` then `retired` — and
 * records the treasury work it cannot do itself. This module does that work,
 * and only ever *builds*: nothing here executes, signs for a guardian, or
 * moves money on its own.
 *
 * Two guardian actions come out of a retirement, and exactly two:
 *
 *  1. **Remove the proposer delegate.** The delegate is a Safe Transaction
 *     Service registration, not an on-chain role (`addSafeDelegate` in
 *     `infra/chain/src/deploy-safe.ts`), so removing it is a `removeSafeDelegate`
 *     call signed by an owner. The request is built and parked; a guardian
 *     completes it from `/guardian`, and `markDelegateRemoved` records that.
 *  2. **Sweep the Safe's USDC** to `config.steward_withdrawal_address`, proposed
 *     through the ordinary proposer → api-kit path so the same two guardians
 *     sign it on the same screen and the ordinary `safe-poll` cron executes it.
 *
 * When both are done the entity is archived: `entities.retired_at` stands, the
 * page keeps its full record, and `config.retire.<slug>.archived_at` is stamped.
 */
import { and, desc, eq } from "drizzle-orm";
import { getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { getConfig, setConfig } from "@/lib/jobs/common";
import { proposerAddress, proposeUsdcPayout } from "@/lib/signing/proposer";
import type { TreasuryDeps } from "@/lib/treasury/deps";
import { readSafeBalance } from "@/lib/treasury/reads";

export const RETIRE_CONFIG_PREFIX = "retire.";

export type DelegateRemovalStep = {
  kind: "delegate_removal";
  /** the Transaction Service holds the delegate; there is nothing on chain to mine */
  onchain: false;
  safe_address: string;
  delegate: string;
  /** api-kit call a guardian's signature completes (*verify* docs/verify.md #7/#44) */
  call: "removeSafeDelegate";
  requires: string;
  status: "pending" | "done";
  done_at: string | null;
};

export type SweepStep = {
  kind: "usdc_sweep";
  onchain: true;
  safe_address: string;
  to: string;
  amount_usdc: string;
  safe_tx_hash: string;
  nonce: number;
  status: "pending" | "executed";
  tx_hash: string | null;
};

export type RetirePlan = {
  entity_id: string;
  slug: string;
  built_at: string;
  steps: [DelegateRemovalStep, SweepStep] | [DelegateRemovalStep];
  archived_at: string | null;
};

export type RetireRefusal = {
  ok: false;
  code: "entity_not_found" | "not_retired" | "no_safe" | "no_withdrawal_address" | "balance_unknown" | "nothing_to_sweep" | "already_built" | "propose_failed";
  message: string;
};

export type BuildResult = { ok: true; plan: RetirePlan; proposals: number } | RetireRefusal;

function planKey(slug: string): string {
  return `${RETIRE_CONFIG_PREFIX}${slug}`;
}

export async function getRetirePlan(db: Db, slug: string): Promise<RetirePlan | null> {
  return (await getConfig<RetirePlan>(db, planKey(slug))) ?? null;
}

/** The `retire_requested` event `retireEntity` wrote, latest first. */
export async function retireRequests(db: Db, entityId: string) {
  return db
    .select()
    .from(schema.entityEvents)
    .where(and(eq(schema.entityEvents.entityId, entityId), eq(schema.entityEvents.kind, "retire_requested")))
    .orderBy(desc(schema.entityEvents.id));
}

/**
 * Build (never execute) the two guardian transactions a retirement needs.
 * Idempotent: a second call returns the plan already on file.
 */
export async function buildRetireProposals(
  db: Db,
  deps: TreasuryDeps,
  entityId: string,
  opts: { actor?: string; rebuild?: boolean } = {},
): Promise<BuildResult> {
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
  if (!entity) return { ok: false, code: "entity_not_found", message: `No entity ${entityId}.` };

  const existing = await getRetirePlan(db, entity.slug);
  if (existing && !opts.rebuild) return { ok: true, plan: existing, proposals: existing.steps.length };

  const requests = await retireRequests(db, entity.id);
  if (!entity.retiredAt && requests.length === 0) {
    return { ok: false, code: "not_retired", message: `${entity.slug} has no retire_requested event; two guardians retire first (governance/pause.ts).` };
  }
  if (!entity.safeAddress || !isAddress(entity.safeAddress)) {
    return { ok: false, code: "no_safe", message: `${entity.slug} has no Safe; there is nothing to sweep and no delegate to remove.` };
  }
  const safe = getAddress(entity.safeAddress);

  const withdrawal = await getConfig<string>(db, "steward_withdrawal_address");
  if (typeof withdrawal !== "string" || !isAddress(withdrawal)) {
    return {
      ok: false,
      code: "no_withdrawal_address",
      message: "config.steward_withdrawal_address is unset or not an address; a retirement must know where the money goes before it asks anyone to sign.",
    };
  }
  const to = getAddress(withdrawal);

  const now = deps.now();
  const actor = opts.actor ?? "retire";
  const delegate = entity.proposerAddress && isAddress(entity.proposerAddress) ? getAddress(entity.proposerAddress) : await proposerAddress(deps, entity.slug);

  const delegateStep: DelegateRemovalStep = {
    kind: "delegate_removal",
    onchain: false,
    safe_address: safe,
    delegate,
    call: "removeSafeDelegate",
    requires: "one Safe owner (a guardian) signs the delegator message; the Transaction Service applies it immediately",
    status: existing?.steps.find((s) => s.kind === "delegate_removal")?.status === "done" ? "done" : "pending",
    done_at: (existing?.steps.find((s) => s.kind === "delegate_removal") as DelegateRemovalStep | undefined)?.done_at ?? null,
  };

  const balance = await readSafeBalance(deps, safe);
  if (balance.balance_usdc === null) {
    return { ok: false, code: "balance_unknown", message: `The Safe's USDC balance could not be read (${balance.reason}); nothing is proposed on a guess.` };
  }
  const amount = Number(balance.balance_usdc);
  if (!(amount > 0)) {
    const plan: RetirePlan = { entity_id: entity.id, slug: entity.slug, built_at: now.toISOString(), steps: [delegateStep], archived_at: null };
    await setConfig(db, planKey(entity.slug), plan, now);
    await appendEntityEvent(db, {
      entity_id: entity.id,
      actor,
      kind: "retire.plan_built",
      payload: { steps: 1, delegate, sweep: "skipped: the Safe holds no USDC" },
      at: now,
    });
    return { ok: true, plan, proposals: 1 };
  }

  const amountStr = amount.toFixed(2);
  let proposed: { safeTxHash: Hex; nonce: number };
  try {
    proposed = await proposeUsdcPayout(deps, { slug: entity.slug, safeAddress: safe, recipient: to, amountUsdc6: parseUnits(amountStr, 6) });
  } catch (err) {
    deps.log(`retire sweep proposal failed for ${entity.slug}: ${(err as Error).message}`);
    return { ok: false, code: "propose_failed", message: `The sweep could not be proposed: ${(err as Error).message.slice(0, 160)}` };
  }

  await db
    .insert(schema.safeProposals)
    .values({
      safeTxHash: proposed.safeTxHash,
      entityId: entity.id,
      submissionId: null,
      nonce: proposed.nonce,
      toAddress: to,
      amountUsdc: amountStr,
      proposedAt: now,
      confirmations: 0,
      status: "pending",
    })
    .onConflictDoNothing();

  const sweepStep: SweepStep = {
    kind: "usdc_sweep",
    onchain: true,
    safe_address: safe,
    to,
    amount_usdc: amountStr,
    safe_tx_hash: proposed.safeTxHash,
    nonce: proposed.nonce,
    status: "pending",
    tx_hash: null,
  };

  const plan: RetirePlan = { entity_id: entity.id, slug: entity.slug, built_at: now.toISOString(), steps: [delegateStep, sweepStep], archived_at: null };
  await setConfig(db, planKey(entity.slug), plan, now);
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor,
    kind: "retire.plan_built",
    payload: { steps: 2, delegate, safe_tx_hash: proposed.safeTxHash, amount_usdc: amountStr, to, executed: false },
    at: now,
  });
  deps.log(`retire plan for ${entity.slug}: remove delegate ${delegate}, sweep ${amountStr} USDC to ${to} (safeTx ${proposed.safeTxHash}); nothing executed`);
  return { ok: true, plan, proposals: 2 };
}

/** A guardian completed `removeSafeDelegate`. Records it; does not call the service. */
export async function markDelegateRemoved(db: Db, deps: TreasuryDeps, entityId: string, byUserId: string | null): Promise<RetirePlan | null> {
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
  if (!entity) return null;
  const plan = await getRetirePlan(db, entity.slug);
  if (!plan) return null;
  const now = deps.now();
  const steps = plan.steps.map((s) => (s.kind === "delegate_removal" ? { ...s, status: "done" as const, done_at: now.toISOString() } : s)) as RetirePlan["steps"];
  const next: RetirePlan = { ...plan, steps };
  await setConfig(db, planKey(entity.slug), next, now);
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: byUserId ?? "guardian",
    kind: "retire.delegate_removed",
    payload: { delegate: (plan.steps.find((s) => s.kind === "delegate_removal") as DelegateRemovalStep | undefined)?.delegate ?? null },
    at: now,
  });
  return next;
}

export type RetireProgress = {
  slug: string;
  delegate_removed: boolean;
  sweep_mined: boolean;
  sweep_tx_hash: string | null;
  archived_at: string | null;
};

/**
 * Are both steps done? The sweep is read from `safe_proposals` (the ordinary
 * poll cron executes it), the delegate removal from the plan. When both are
 * done the entity is archived.
 */
export async function checkRetireProgress(db: Db, deps: TreasuryDeps, entityId: string): Promise<RetireProgress | null> {
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
  if (!entity) return null;
  const plan = await getRetirePlan(db, entity.slug);
  if (!plan) return null;

  const delegateStep = plan.steps.find((s) => s.kind === "delegate_removal") as DelegateRemovalStep | undefined;
  const sweepStep = plan.steps.find((s) => s.kind === "usdc_sweep") as SweepStep | undefined;
  const delegateRemoved = delegateStep?.status === "done";

  let sweepMined = sweepStep === undefined;
  let sweepTx: string | null = sweepStep?.tx_hash ?? null;
  if (sweepStep) {
    const [row] = await db.select().from(schema.safeProposals).where(eq(schema.safeProposals.safeTxHash, sweepStep.safe_tx_hash)).limit(1);
    if (row?.status === "executed" && row.executedTxHash) {
      sweepMined = true;
      sweepTx = row.executedTxHash;
    }
  }

  const now = deps.now();
  let archivedAt = plan.archived_at;
  if (delegateRemoved && sweepMined && !archivedAt) {
    archivedAt = now.toISOString();
    const steps = plan.steps.map((s) => (s.kind === "usdc_sweep" ? { ...s, status: "executed" as const, tx_hash: sweepTx } : s)) as RetirePlan["steps"];
    await setConfig(db, planKey(entity.slug), { ...plan, steps, archived_at: archivedAt }, now);
    if (!entity.retiredAt) await db.update(schema.entities).set({ retiredAt: now }).where(eq(schema.entities.id, entity.id));
    await appendEntityEvent(db, {
      entity_id: entity.id,
      actor: "retire",
      kind: "retire.archived",
      payload: { archived_at: archivedAt, sweep_tx_hash: sweepTx, delegate_removed: true, record: "the page keeps its full record; nothing is deleted" },
      at: now,
    });
    deps.log(`${entity.slug} archived: delegate removed and Safe swept in ${sweepTx ?? "no sweep needed"}`);
  } else if (sweepStep && sweepMined && sweepStep.tx_hash !== sweepTx) {
    const steps = plan.steps.map((s) => (s.kind === "usdc_sweep" ? { ...s, status: "executed" as const, tx_hash: sweepTx } : s)) as RetirePlan["steps"];
    await setConfig(db, planKey(entity.slug), { ...plan, steps }, now);
  }

  return { slug: entity.slug, delegate_removed: delegateRemoved, sweep_mined: sweepMined, sweep_tx_hash: sweepTx, archived_at: archivedAt };
}
