/**
 * Step 4's phase-2 tail: the Safe is deployed on the **second** guardian
 * acceptance (architecture Appendix A.1; plan T3.1 → T2.2), with the creator
 * and the two guardians as owners, threshold 2.
 *
 * This module does not implement Safe deployment — `@kami/chain`'s
 * `deploySafe` does, and `src/lib/signing/deployer.ts` holds the key. What
 * lives here is the *trigger* and, far more often in practice, the honest
 * "not yet" : until the deployer key, an RPC and three wallet addresses all
 * exist, deployment is recorded as **pending** and the page says so rather
 * than implying a treasury that is not there.
 *
 * Idempotent: calling it twice deploys nothing twice (the CREATE2 address is
 * derived from the slug, and `entities.safe_address` is written once).
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { entityHasTwoNonFounderGuardians } from "@/lib/governance/roles";
import { getConfig, setConfig } from "@/lib/jobs/common";
import { signingEnv } from "@/lib/signing/env";

export type SafeState = "deployed" | "pending" | "not_ready";

export type SafeReadiness = {
  entity_id: string;
  slug: string;
  state: SafeState;
  safe_address: string | null;
  two_guardians: boolean;
  /** creator + guardians, in owner order; a null wallet blocks deployment */
  owners: Array<{ user_id: string; role: "steward" | "guardian"; wallet: string | null }>;
  missing_wallets: number;
  chain_configured: boolean;
  reason: string;
};

export function safePendingKey(slug: string): string {
  return `safe_pending.${slug}`;
}

/** True when a deployer key and an RPC are both configured; false is the normal phase-1 answer. */
export function chainConfigured(env = signingEnv()): boolean {
  const hasBackend = env.SIGNING_BACKEND === "local" ? Boolean(env.KAMI_LOCAL_KEYS_JSON) : Boolean(env.SIGNING_BACKEND);
  return hasBackend && Boolean(env.RPC_URL_BASE) && Boolean(env.CHAIN_ID);
}

export async function safeReadiness(db: DbOrTx, entityId: string): Promise<SafeReadiness> {
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
  if (!entity) throw new Error(`no entity ${entityId}`);
  const roles = await db
    .select({ userId: schema.entityRoles.userId, role: schema.entityRoles.role, wallet: schema.users.walletAddress })
    .from(schema.entityRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.entityRoles.userId))
    .where(
      and(
        eq(schema.entityRoles.entityId, entityId),
        isNotNull(schema.entityRoles.acceptedAt),
        isNull(schema.entityRoles.revokedAt),
      ),
    );
  const guardians = roles.filter((r) => r.role === "guardian" && r.userId !== entity.createdBy);
  const creator = entity.createdBy ? roles.find((r) => r.userId === entity.createdBy) : undefined;
  const owners: SafeReadiness["owners"] = [
    ...(creator ? [{ user_id: creator.userId, role: "steward" as const, wallet: creator.wallet }] : []),
    ...guardians.slice(0, 2).map((g) => ({ user_id: g.userId, role: "guardian" as const, wallet: g.wallet })),
  ];
  const two_guardians = await entityHasTwoNonFounderGuardians(db, entityId);
  const missing_wallets = owners.filter((o) => !o.wallet).length + Math.max(0, 3 - owners.length);
  const chain_configured = chainConfigured();

  let state: SafeState;
  let reason: string;
  if (entity.safeAddress) {
    state = "deployed";
    reason = `Safe ${entity.safeAddress} is deployed with 3 owners and a threshold of 2.`;
  } else if (!two_guardians) {
    state = "not_ready";
    reason = "Two guardians who are not the founder have not both accepted yet.";
  } else if (!chain_configured) {
    state = "pending";
    reason = "Safe deployment is not configured on this deployment (no deployer key or RPC). It is recorded as pending; a chain operator runs it.";
  } else if (missing_wallets > 0) {
    state = "pending";
    reason = `${missing_wallets} of the three owners has no wallet address yet, so the Safe cannot be deployed. It is recorded as pending.`;
  } else {
    state = "pending";
    reason = "Ready to deploy.";
  }
  return { entity_id: entityId, slug: entity.slug, state, safe_address: entity.safeAddress, two_guardians, owners, missing_wallets, chain_configured, reason };
}

export type DeploySafeFn = (input: { entity_id: string; slug: string; owners: string[] }) => Promise<{ address: string; tx_hash?: string }>;

export type SafeTriggerResult = SafeReadiness & { deployed_now: boolean };

/**
 * Called after a guardian accepts (and on every later visit to the summon
 * status page, harmlessly). With `deploy` injected — the orchestrator wires
 * `@kami/chain`'s `deploySafe` behind `src/lib/signing/deployer.ts` — it
 * deploys once; without it, it records that deployment is pending.
 */
export async function triggerSafeDeployment(
  db: DbOrTx,
  entityId: string,
  deps: { deploy?: DeploySafeFn | null; now?: Date; actor?: string | null } = {},
): Promise<SafeTriggerResult> {
  const now = deps.now ?? new Date();
  const readiness = await safeReadiness(db, entityId);
  if (readiness.state === "deployed") return { ...readiness, deployed_now: false };
  if (!readiness.two_guardians) return { ...readiness, deployed_now: false };

  const canDeploy = deps.deploy && readiness.chain_configured && readiness.missing_wallets === 0;
  if (!canDeploy) {
    const key = safePendingKey(readiness.slug);
    const prior = await getConfig<{ recorded_at?: string }>(db, key);
    await setConfig(db, key, { entity_id: entityId, reason: readiness.reason, recorded_at: prior?.recorded_at ?? now.toISOString(), last_checked_at: now.toISOString() }, now);
    if (!prior) {
      await appendEntityEvent(db, {
        entity_id: entityId,
        actor: deps.actor ?? null,
        kind: "safe_deployment_pending",
        payload: { reason: readiness.reason, chain_configured: readiness.chain_configured, missing_wallets: readiness.missing_wallets },
        at: now,
      });
    }
    return { ...readiness, state: "pending", deployed_now: false };
  }

  const result = await deps.deploy!({ entity_id: entityId, slug: readiness.slug, owners: readiness.owners.map((o) => o.wallet!) });
  await db.update(schema.entities).set({ safeAddress: result.address }).where(eq(schema.entities.id, entityId));
  await appendEntityEvent(db, {
    entity_id: entityId,
    actor: deps.actor ?? null,
    kind: "safe_deployed",
    payload: { safe_address: result.address, tx_hash: result.tx_hash ?? null, owners: readiness.owners.map((o) => o.wallet) },
    at: now,
  });
  return { ...readiness, state: "deployed", safe_address: result.address, deployed_now: true };
}
