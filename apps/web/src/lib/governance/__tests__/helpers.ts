/**
 * Shared PGlite fixtures for the governance tests: an entity with guardians,
 * evaluators and a contributor, plus one open bounty ready to claim.
 */
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, seedEntity, seedUser, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import type { EntityRoleName } from "@/db/schema";
import { approveBounty, createBountyDraft, type BountySpecInput } from "../bounties";
import { setConfigValue } from "../config";

export { closeTestDb, createTestDb, seedEntity, seedUser };
export type { TestDb };

export async function addRole(db: TestDb, entityId: string, userId: string, role: EntityRoleName, opts: { accepted?: boolean; hatId?: string | null } = {}) {
  await db
    .insert(schema.entityRoles)
    .values({ entityId, userId, role, acceptedAt: opts.accepted === false ? null : new Date(), hatId: opts.hatId ?? null })
    .onConflictDoUpdate({
      target: [schema.entityRoles.entityId, schema.entityRoles.userId, schema.entityRoles.role],
      set: { acceptedAt: opts.accepted === false ? null : new Date(), revokedAt: null },
    });
}

export function specFor(entityId: string, over: Partial<BountySpecInput> = {}): BountySpecInput {
  return {
    entity_id: entityId,
    title: "Photograph the three diversion structures",
    why: "Flow at Orodell is low and I want a record of how much is being taken.",
    deliverable: "Before/after photos of each structure, geotagged, two days at least 48 h apart",
    verification_tier: 2,
    evidence_spec: { min_photos: 2, exif_required: true, gps_within_m: 50, capture: "in_app", second_attestation_above_usdc: 100 },
    cap_usdc: 40,
    claim_limit: 1,
    deadline: "2099-09-21",
    evaluator_hat: null,
    linked_strategy: null,
    twin_refs: ["place/boulder-creek-near-orodell-co", "watershed/huc10-1019000504"],
    prediction: null,
    ...over,
  };
}

export type World = {
  db: TestDb;
  entityId: string;
  slug: string;
  founder: string;
  guardianA: string;
  guardianB: string;
  evaluator: string;
  evaluator2: string;
  contributor: string;
};

/** One entity, a founder, two guardians, two evaluators and a contributor. */
export async function seedWorld(db: TestDb, slug = "boulder-creek"): Promise<World> {
  const entity = await seedEntity(db, { slug });
  const ids = {
    founder: `u-founder-${slug}`,
    guardianA: `u-guard-a-${slug}`,
    guardianB: `u-guard-b-${slug}`,
    evaluator: `u-eval-${slug}`,
    evaluator2: `u-eval2-${slug}`,
    contributor: `u-contrib-${slug}`,
  };
  for (const id of Object.values(ids)) await seedUser(db, id);
  // The shared contributor clears the Passport gate; tests that exercise the
  // gate seed their own low-scoring users.
  await db.update(schema.users).set({ passportScore: "30" }).where(eq(schema.users.id, ids.contributor));
  await db.update(schema.entities).set({ createdBy: ids.founder }).where(eq(schema.entities.id, entity.id));
  await addRole(db, entity.id, ids.founder, "guardian");
  await addRole(db, entity.id, ids.founder, "steward");
  await addRole(db, entity.id, ids.guardianA, "guardian");
  await addRole(db, entity.id, ids.guardianB, "guardian");
  await addRole(db, entity.id, ids.evaluator, "evaluator");
  await addRole(db, entity.id, ids.evaluator2, "evaluator");
  return { db, entityId: entity.id, slug, ...ids };
}

/** A draft approved into `open`. */
export async function openBounty(w: World, over: Partial<BountySpecInput> = {}) {
  const draft = await createBountyDraft(w.db, specFor(w.entityId, over), { actor: null });
  const res = await approveBounty(w.db, draft.id, w.guardianA);
  return res.bounty;
}

/** A submission with a summary, without touching the object store. */
export async function submitEvidence(w: World, bountyId: string, userId: string, note = "did the work") {
  const [claim] = await w.db.select().from(schema.claims).where(eq(schema.claims.bountyId, bountyId)).limit(1);
  const id = `sub_${Math.random().toString(16).slice(2, 10)}`;
  await w.db.insert(schema.submissions).values({
    id,
    claimId: claim!.id,
    noteMd: note,
    evidenceSummary: { photo_count: 2, exif_ok_count: 2, gps_within_spec_count: 2, captured_at_range: null, in_app_capture_count: 2, note },
  });
  await w.db.update(schema.bounties).set({ status: "in_review" }).where(eq(schema.bounties.id, bountyId));
  void userId;
  return id;
}

/**
 * A claimant seeded fresh for one test, with a Passport score above the
 * minimum, so the per-person monthly cap does not leak between tests.
 */
export async function freshContributor(db: TestDb, label = Math.random().toString(16).slice(2, 10)): Promise<string> {
  const id = `u-contrib-${label}`;
  await seedUser(db, id);
  await db.update(schema.users).set({ passportScore: "30" }).where(eq(schema.users.id, id));
  return id;
}

export async function setConfig(db: TestDb, key: string, value: unknown) {
  await setConfigValue(db, key, value);
}

/** drizzle wraps driver errors; Postgres' message is in `cause`. */
export async function expectDbError(p: Promise<unknown>, re: RegExp) {
  let caught: unknown;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  if (!caught) throw new Error("expected the query to fail");
  const err = caught as Error & { cause?: Error };
  const message = `${err.message}\n${err.cause?.message ?? ""}`;
  if (!re.test(message)) throw new Error(`expected ${re} in:\n${message}`);
}
