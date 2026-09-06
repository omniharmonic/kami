/**
 * Page reads. Every function returns an honest empty value when Neon is
 * unset or unreachable (ADR-E14); the status file is the other source.
 */
import { cache } from "react";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { withDb } from "@/db/client";
import * as schema from "@/db/schema";
import { loadStatus, slugIsValid, type Status } from "./status";
import type { BountyView, ProposalView } from "@/components/Board";
import type { PayoutView } from "@/components/Treasury";
import type { PersonView } from "@/components/People";
import type { SiblingView } from "@/components/Siblings";
import type { StrategyView } from "@/components/Strategy";

export type EntityView = {
  id: string;
  slug: string;
  name: string;
  archetype: string;
  paused: boolean;
  retired: boolean;
  safe_address: string | null;
  consultation_md: string | null;
  consultation_done_at: string | null;
  binding_version: number | null;
  soul_version: number | null;
  hermes_profile: string | null;
  /** true when the row came from Neon; false when derived from the status file */
  from_db: boolean;
};

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export const getStatusCached = cache(async (slug: string): Promise<Status | null> => loadStatus(slug));

/** Entity by slug: Neon first, else the status file (name from the slug, archetype from the file when present). */
export const getEntityBySlug = cache(async (slug: string): Promise<EntityView | null> => {
  if (!slugIsValid(slug)) return null;
  const row = await withDb(
    async (db) => (await db.select().from(schema.entities).where(eq(schema.entities.slug, slug)).limit(1))[0] ?? null,
    null,
  );
  if (row) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      archetype: row.archetype,
      paused: row.pausedAt !== null,
      retired: row.retiredAt !== null,
      safe_address: row.safeAddress,
      consultation_md: row.consultationMd,
      consultation_done_at: row.consultationDoneAt?.toISOString() ?? null,
      binding_version: row.bindingVersion,
      soul_version: row.soulVersion,
      hermes_profile: row.hermesProfile,
      from_db: true,
    };
  }
  const status = await getStatusCached(slug);
  if (!status) return null;
  return {
    id: status.snapshot.entity_id,
    slug,
    name: status.entity?.name ?? titleFromSlug(slug),
    archetype: status.entity?.archetype ?? "creek",
    paused: status.snapshot.paused,
    retired: false,
    safe_address: status.treasury.safe_address,
    consultation_md: null,
    consultation_done_at: null,
    binding_version: null,
    soul_version: null,
    hermes_profile: null,
    from_db: false,
  };
});

export async function listPublicEntities(): Promise<Array<{ slug: string; name: string; archetype: string; paused: boolean }>> {
  const rows = await withDb(
    async (db) =>
      db
        .select({ slug: schema.entities.slug, name: schema.entities.name, archetype: schema.entities.archetype, pausedAt: schema.entities.pausedAt })
        .from(schema.entities)
        .where(and(isNull(schema.entities.retiredAt), isNotNull(schema.entities.consultationDoneAt)))
        .orderBy(schema.entities.name),
    null,
  );
  if (rows) return rows.map((r) => ({ slug: r.slug, name: r.name, archetype: r.archetype, paused: r.pausedAt !== null }));
  // No DB: whatever the local data dir holds (dev only).
  const { listLocalStatusSlugs } = await import("./status");
  const out = [];
  for (const slug of await listLocalStatusSlugs()) {
    const e = await getEntityBySlug(slug);
    if (e) out.push({ slug: e.slug, name: e.name, archetype: e.archetype, paused: e.paused });
  }
  return out;
}

export async function getPeople(entityId: string): Promise<PersonView[]> {
  return withDb(async (db) => {
    const rows = await db
      .select({ role: schema.entityRoles.role, name: schema.users.name, email: schema.users.email, acceptedAt: schema.entityRoles.acceptedAt })
      .from(schema.entityRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.entityRoles.userId))
      .where(and(eq(schema.entityRoles.entityId, entityId), isNotNull(schema.entityRoles.acceptedAt), isNull(schema.entityRoles.revokedAt)));
    return rows.map((r) => ({ role: r.role, name: r.name ?? r.email.split("@")[0] ?? "someone", accepted_at: r.acceptedAt?.toISOString() ?? null }));
  }, []);
}

/** Other entities whose latest approved binding has the same anchor place id. */
export async function getSiblings(entityId: string): Promise<SiblingView[]> {
  return withDb(async (db) => {
    const [mine] = await db
      .select({ binding: schema.entityBindings.binding })
      .from(schema.entityBindings)
      .where(eq(schema.entityBindings.entityId, entityId))
      .orderBy(desc(schema.entityBindings.bindingVersion))
      .limit(1);
    const anchor = (mine?.binding as { anchor?: string } | undefined)?.anchor;
    if (!anchor) return [];
    const rows = await db
      .selectDistinct({ slug: schema.entities.slug, name: schema.entities.name, archetype: schema.entities.archetype })
      .from(schema.entityBindings)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.entityBindings.entityId))
      .where(
        and(
          ne(schema.entityBindings.entityId, entityId),
          isNull(schema.entities.retiredAt),
          sql`${schema.entityBindings.binding} ->> 'anchor' = ${anchor}`,
        ),
      );
    return rows;
  }, []);
}

export async function getBounties(entityId: string): Promise<BountyView[]> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(schema.bounties)
      .where(and(eq(schema.bounties.entityId, entityId), inArray(schema.bounties.status, ["open", "claimed", "in_review", "paid", "deferred"])))
      .orderBy(desc(schema.bounties.createdAt))
      .limit(20);
    return rows.map((b) => ({ id: b.id, title: b.title, status: b.status, cap_usdc: b.capUsdc, verification_tier: b.verificationTier, deadline: b.deadline }));
  }, []);
}

export async function getHumanProposals(entityId: string): Promise<ProposalView[]> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(schema.proposals)
      .where(and(eq(schema.proposals.entityId, entityId), eq(schema.proposals.authorKind, "human"), eq(schema.proposals.status, "open")))
      .orderBy(schema.proposals.rank)
      .limit(20);
    return rows.map((p) => ({ id: p.id, title: p.title, rank: p.rank, rank_reason_md: p.rankReasonMd }));
  }, []);
}

export async function getPayouts(entityId: string): Promise<PayoutView[]> {
  return withDb(async (db) => {
    const rows = await db
      .select({
        id: schema.payouts.id,
        amount: schema.payouts.amountUsdc,
        executedAt: schema.payouts.executedAt,
        txHash: schema.payouts.txHash,
        uid: schema.payouts.easUidCompleted,
        title: schema.bounties.title,
      })
      .from(schema.payouts)
      .innerJoin(schema.submissions, eq(schema.submissions.id, schema.payouts.submissionId))
      .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
      .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
      .where(eq(schema.bounties.entityId, entityId))
      .orderBy(desc(schema.payouts.executedAt))
      .limit(50);
    return rows.map((r) => ({ id: r.id, amount_usdc: r.amount, executed_at: r.executedAt?.toISOString() ?? null, tx_hash: r.txHash, eas_uid_completed: r.uid, title: r.title }));
  }, []);
}

export async function getStrategy(entityId: string): Promise<StrategyView> {
  return withDb(async (db) => {
    const [s] = await db
      .select()
      .from(schema.strategies)
      .where(and(eq(schema.strategies.entityId, entityId), isNotNull(schema.strategies.ratifiedAt)))
      .orderBy(desc(schema.strategies.ratifiedAt))
      .limit(1);
    return s ? { quarter: s.quarter, memo_md: s.memoMd, comment_open_until: s.commentOpenUntil?.toISOString() ?? null } : null;
  }, null);
}

export async function getSoul(entityId: string) {
  return withDb(async (db) => {
    const [s] = await db.select().from(schema.souls).where(eq(schema.souls.entityId, entityId)).orderBy(desc(schema.souls.soulVersion)).limit(1);
    return s ? { version: s.soulVersion, hard_rules_version: s.hardRulesVersion, voice_md: s.voiceMd } : null;
  }, null);
}

export async function getBinding(entityId: string) {
  return withDb(async (db) => {
    const [b] = await db.select().from(schema.entityBindings).where(eq(schema.entityBindings.entityId, entityId)).orderBy(desc(schema.entityBindings.bindingVersion)).limit(1);
    return b ? { version: b.bindingVersion, sha256: b.sha256, review: b.review, binding: b.binding } : null;
  }, null);
}

export async function getPauseDrills(entityId: string) {
  return withDb(async (db) => {
    const rows = await db.select().from(schema.pauseEvents).where(eq(schema.pauseEvents.entityId, entityId)).orderBy(desc(schema.pauseEvents.at)).limit(10);
    return rows.map((r) => ({ at: r.at?.toISOString() ?? "", action: r.action }));
  }, []);
}

export async function getGuardDropRate(entityId: string): Promise<number | null> {
  return withDb(async (db) => {
    const [r] = await db
      .select({ dropped: sql<number>`count(*) filter (where ${schema.guardEvents.action} = 'dropped')::int`, total: sql<number>`count(*)::int` })
      .from(schema.guardEvents)
      .where(eq(schema.guardEvents.entityId, entityId));
    if (!r || r.total === 0) return null;
    return (100 * r.dropped) / r.total;
  }, null);
}

export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  return withDb(async (db) => {
    const [r] = await db.select().from(schema.config).where(eq(schema.config.key, key)).limit(1);
    const v = r?.value;
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  }, fallback);
}
