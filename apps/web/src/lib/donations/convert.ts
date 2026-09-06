/**
 * The monthly conversion: card money that Stripe already holds becomes USDC in
 * the entity's Safe (architecture §6.6, Appendix A.5).
 *
 * Two steps, deliberately:
 *
 *  1. **An operator records the Stripe USDC payout.** Stripe paying out USDC to
 *     the platform treasury wallet is a human action in a dashboard, in a
 *     jurisdiction we have not verified (docs/verify.md #13). It is modelled
 *     here as a *recorded* step — `recordOperatorPayout` — and nothing in this
 *     package can perform it. `convertEntity` refuses without one, so the
 *     ledger can never claim money arrived that nobody saw arrive.
 *  2. **The relayer forwards it.** `treasury_transfers {kind: 'conversion_in'}`
 *     is written first, then `USDC.transfer(safe, Σ net)`, then the tx hash is
 *     stamped onto the transfer row and every donation it covered.
 *
 * The platform never custodies fiat; this module only moves USDC it already
 * holds, and it moves it in one direction, to one address: the entity's Safe.
 */
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { encodeFunctionData, getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import { ERC20_ABI } from "@kami/chain";
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { activeEntities, getConfig, setConfig } from "@/lib/jobs/common";
import type { TreasuryDeps } from "@/lib/treasury/deps";
import { round2 } from "./fees";

export const OPERATOR_PAYOUT_PREFIX = "stripe_payouts.";

/** Card rails whose money sits with Stripe until an operator pays it out. */
export const FIAT_RAILS = ["card", "stablecoin_checkout"] as const;

export type OperatorPayout = {
  reference: string;
  amount_usd: number;
  recorded_at: string;
  recorded_by: string;
  /** Stripe's own payout id, when the operator has it */
  stripe_payout_id: string | null;
  note: string | null;
  /** dollars already forwarded to Safes against this payout */
  spent_usd: number;
};

/**
 * An operator states: "Stripe paid out $X in USDC to the platform treasury
 * wallet." Nothing here contacts Stripe; this is a signed-off human record.
 */
export async function recordOperatorPayout(
  db: Db,
  deps: TreasuryDeps,
  input: { reference: string; amountUsd: number; recordedBy: string; stripePayoutId?: string | null; note?: string | null },
): Promise<OperatorPayout> {
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(input.reference)) throw new TypeError(`bad payout reference: ${input.reference}`);
  const amount = round2(input.amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) throw new TypeError("operator payout must be a positive amount");
  const existing = await getConfig<OperatorPayout>(db, `${OPERATOR_PAYOUT_PREFIX}${input.reference}`);
  const row: OperatorPayout = {
    reference: input.reference,
    amount_usd: amount,
    recorded_at: deps.now().toISOString(),
    recorded_by: input.recordedBy,
    stripe_payout_id: input.stripePayoutId ?? null,
    note: input.note ?? null,
    spent_usd: existing?.spent_usd ?? 0,
  };
  await setConfig(db, `${OPERATOR_PAYOUT_PREFIX}${input.reference}`, row, deps.now());
  deps.log(`operator payout ${input.reference} recorded: ${amount.toFixed(2)} USD by ${input.recordedBy}`);
  return row;
}

export async function getOperatorPayout(db: Db, reference: string): Promise<OperatorPayout | null> {
  return (await getConfig<OperatorPayout>(db, `${OPERATOR_PAYOUT_PREFIX}${reference}`)) ?? null;
}

// ---------------------------------------------------------------------------

export type Convertible = { id: string; net: string; gross: string | null; receivedAt: Date | null; rail: string };

/** Card / stablecoin donations for this entity that have not yet reached the Safe. */
export async function unconvertedDonations(db: Db, entityId: string, before?: Date): Promise<Convertible[]> {
  const rows = await db
    .select({ id: schema.donations.id, net: schema.donations.net, gross: schema.donations.gross, receivedAt: schema.donations.receivedAt, rail: schema.donations.rail })
    .from(schema.donations)
    .where(
      and(
        eq(schema.donations.entityId, entityId),
        inArray(schema.donations.rail, [...FIAT_RAILS]),
        isNull(schema.donations.chainTxHash),
        before ? lt(schema.donations.receivedAt, before) : sql`true`,
      ),
    )
    .orderBy(asc(schema.donations.receivedAt));
  return rows.map((r) => ({ id: r.id, net: r.net ?? "0.00", gross: r.gross, receivedAt: r.receivedAt, rail: r.rail }));
}

export type ConversionRefusal = {
  ok: false;
  code: "no_safe" | "nothing_to_convert" | "operator_payout_required" | "operator_payout_too_small" | "entity_retired" | "transfer_failed";
  message: string;
};

export type ConversionResult =
  | {
      ok: true;
      entity: string;
      transfer_id: string;
      amount_usdc: string;
      donations: string[];
      tx_hash: Hex | null;
      dry_run: boolean;
    }
  | ConversionRefusal;

export function transferIdFor(entityId: string, at: Date): string {
  return `tt_${entityId.replace(/[^a-z0-9]/gi, "").slice(0, 16)}_${at.toISOString().slice(0, 10)}_${at.getTime().toString(36)}`;
}

/**
 * Sum this entity's unconverted card donations and forward the net to its Safe.
 * `operatorPayoutRef` names the recorded Stripe payout the money comes out of;
 * without it nothing moves.
 */
export async function convertEntity(
  db: Db,
  deps: TreasuryDeps,
  entity: typeof schema.entities.$inferSelect,
  opts: { operatorPayoutRef: string; before?: Date; dryRun?: boolean },
): Promise<ConversionResult> {
  if (entity.retiredAt) return { ok: false, code: "entity_retired", message: `${entity.slug} is retired; its Safe is being wound down, not topped up.` };
  if (!entity.safeAddress || !isAddress(entity.safeAddress)) return { ok: false, code: "no_safe", message: `${entity.slug} has no Safe address yet.` };

  const rows = await unconvertedDonations(db, entity.id, opts.before);
  if (rows.length === 0) return { ok: false, code: "nothing_to_convert", message: `Nothing unconverted for ${entity.slug}.` };
  const total = round2(rows.reduce((s, r) => s + Number(r.net ?? 0), 0));
  if (total <= 0) return { ok: false, code: "nothing_to_convert", message: `Unconverted donations for ${entity.slug} net to zero.` };

  const payout = await getOperatorPayout(db, opts.operatorPayoutRef);
  if (!payout) {
    return {
      ok: false,
      code: "operator_payout_required",
      message: `No recorded Stripe USDC payout "${opts.operatorPayoutRef}". An operator records the payout first; this job never invents one.`,
    };
  }
  const remaining = round2(payout.amount_usd - payout.spent_usd);
  if (remaining + 1e-9 < total) {
    return {
      ok: false,
      code: "operator_payout_too_small",
      message: `Payout ${payout.reference} has ${remaining.toFixed(2)} USD left, less than the ${total.toFixed(2)} USD owed to ${entity.slug}.`,
    };
  }

  const now = deps.now();
  const safe = getAddress(entity.safeAddress);
  const transferId = transferIdFor(entity.id, now);
  const amountStr = total.toFixed(2);

  await db.insert(schema.treasuryTransfers).values({
    id: transferId,
    entityId: entity.id,
    amountUsdc: amountStr,
    kind: "conversion_in",
    at: now,
  });
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: "conversion",
    kind: "treasury.conversion_in",
    payload: { transfer_id: transferId, amount_usdc: amountStr, donations: rows.map((r) => r.id), operator_payout_ref: payout.reference, safe },
    at: now,
  });

  if (opts.dryRun) {
    return { ok: true, entity: entity.slug, transfer_id: transferId, amount_usdc: amountStr, donations: rows.map((r) => r.id), tx_hash: null, dry_run: true };
  }

  let txHash: Hex;
  try {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [safe, parseUnits(amountStr, 6)] });
    txHash = await deps.relayerSend({ to: deps.chain.usdc.address as Address, data });
  } catch (err) {
    deps.log(`conversion transfer failed for ${entity.slug}: ${(err as Error).message}`);
    await appendEntityEvent(db, {
      entity_id: entity.id,
      actor: "conversion",
      kind: "treasury.conversion_failed",
      payload: { transfer_id: transferId, amount_usdc: amountStr, error: (err as Error).message.slice(0, 200) },
      at: deps.now(),
    });
    return { ok: false, code: "transfer_failed", message: `The USDC transfer to ${entity.slug}'s Safe did not go out; the conversion row stays open.` };
  }

  await db.update(schema.treasuryTransfers).set({ txHash }).where(eq(schema.treasuryTransfers.id, transferId));
  await db.update(schema.donations).set({ chainTxHash: txHash }).where(inArray(schema.donations.id, rows.map((r) => r.id)));
  await setConfig(db, `${OPERATOR_PAYOUT_PREFIX}${payout.reference}`, { ...payout, spent_usd: round2(payout.spent_usd + total) }, deps.now());
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: "relayer",
    kind: "treasury.conversion_sent",
    payload: { transfer_id: transferId, amount_usdc: amountStr, tx_hash: txHash, donations: rows.length, safe },
    at: deps.now(),
  });
  deps.log(`converted ${amountStr} USDC into ${entity.slug}'s Safe in ${txHash}`);
  return { ok: true, entity: entity.slug, transfer_id: transferId, amount_usdc: amountStr, donations: rows.map((r) => r.id), tx_hash: txHash, dry_run: false };
}

/** Every active entity, one conversion each, against one recorded operator payout. */
export async function runConversion(
  db: Db,
  deps: TreasuryDeps,
  opts: { operatorPayoutRef: string; slug?: string; before?: Date; dryRun?: boolean },
): Promise<Array<ConversionResult & { entity_slug: string }>> {
  const entities = await activeEntities(db, opts.slug);
  const out: Array<ConversionResult & { entity_slug: string }> = [];
  for (const e of entities) {
    const r = await convertEntity(db, deps, e, opts);
    out.push({ ...r, entity_slug: e.slug });
  }
  return out;
}
