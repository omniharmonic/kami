/**
 * Row seeds for the money-layer tests: one entity with a Safe, a guardian, a
 * claimant with a wallet, a bounty → claim → submission → evaluation chain.
 */
import { keccak256, stringToBytes } from "viem";
import * as schema from "@/db/schema";
import { seedEntity, seedUser, type TestDb } from "@/db/test-utils";
import { RECIPIENT, SAFE } from "./fakes";

export type Seeded = Awaited<ReturnType<typeof seedPayoutChain>>;

export async function seedPayoutChain(
  db: TestDb,
  opts: {
    slug?: string;
    capUsdc?: string;
    outcome?: "succeeded" | "partial" | "failed" | "unverifiable";
    easUid?: string | null;
    offchain?: Record<string, unknown> | null;
    wallet?: string | null;
    tier?: number;
    paused?: boolean;
    secondAttestationBy?: string | null;
  } = {},
) {
  const slug = opts.slug ?? "boulder-creek";
  const entity = await seedEntity(db, { slug, paused: opts.paused ?? false });
  await db
    .update(schema.entities)
    .set({ safeAddress: SAFE, chainId: 84532, proposerAddress: null })
    .where(schema.entities.id.name ? undefined : undefined);
  await db.execute(
    // drizzle `update ... where` with a plain eq is simpler, but the import is
    // already heavy here; a direct SQL update keeps the seed short.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import("drizzle-orm")).sql`update entities set safe_address = ${SAFE}, chain_id = 84532 where id = ${entity.id}`,
  );

  const claimant = await seedUser(db, `claimant-${slug}`);
  const evaluator = await seedUser(db, `evaluator-${slug}`);
  const guardian = await seedUser(db, `guardian-${slug}`);
  const second = opts.secondAttestationBy === undefined ? await seedUser(db, `second-${slug}`) : null;
  const wallet = opts.wallet === undefined ? RECIPIENT : opts.wallet;
  if (wallet) {
    const { eq } = await import("drizzle-orm");
    await db.update(schema.users).set({ walletAddress: wallet, passportScore: "25" }).where(eq(schema.users.id, claimant.id));
  }
  await db.insert(schema.entityRoles).values([
    { entityId: entity.id, userId: guardian.id, role: "guardian", acceptedAt: new Date("2026-01-01T00:00:00Z") },
    { entityId: entity.id, userId: evaluator.id, role: "evaluator", acceptedAt: new Date("2026-01-01T00:00:00Z") },
  ]);

  const bountyId = `bounty-${slug}`;
  const spec = { id: bountyId, title: "Photograph the gauge" };
  await db.insert(schema.bounties).values({
    id: bountyId,
    entityId: entity.id,
    title: "Photograph the gauge",
    whyMd: "The gauge has been quiet.",
    deliverableMd: "Two photos of the staff gauge with the time visible.",
    verificationTier: opts.tier ?? 2,
    evidenceSpec: { photos: 2 },
    capUsdc: opts.capUsdc ?? "25.00",
    twinRefs: ["place/boulder-creek-orodell"],
    specSha256: keccak256(stringToBytes(JSON.stringify(spec))).slice(2).length === 64 ? keccak256(stringToBytes(JSON.stringify(spec))) : "deadbeef",
    status: "in_review",
    createdAt: new Date("2026-08-01T00:00:00Z"),
  });

  const claimId = `claim-${slug}`;
  await db.insert(schema.claims).values({ id: claimId, bountyId, userId: claimant.id, claimedAt: new Date("2026-08-02T00:00:00Z") });
  const submissionId = `sub-${slug}`;
  await db.insert(schema.submissions).values({
    id: submissionId,
    claimId,
    submittedAt: new Date("2026-08-03T00:00:00Z"),
    noteMd: "Took both photos at the gauge.",
    evidenceSummary: { photos: 2, in_app_capture: true },
  });
  await db.insert(schema.evidenceFiles).values({
    id: `ev-${slug}-1`,
    submissionId,
    r2Key: `evidence/${submissionId}/1.jpg`,
    sha256: "a".repeat(64),
    mime: "image/jpeg",
    bytes: 12345,
    inAppCapture: true,
    licenceAcceptedAt: new Date("2026-08-03T00:00:00Z"),
    capturedAt: new Date("2026-08-03T00:00:00Z"),
  });

  const evaluationId = `eval-${slug}`;
  const easUid = opts.easUid === undefined ? `0x${"1".repeat(64)}` : opts.easUid;
  await db.insert(schema.evaluations).values({
    id: evaluationId,
    submissionId,
    evaluatorId: evaluator.id,
    outcome: opts.outcome ?? "succeeded",
    notesMd: "Both photos match the deliverable.",
    easUid,
    offchainAttestation: opts.offchain ?? null,
    attestedAt: new Date("2026-08-04T00:00:00Z"),
    secondAttestationBy: opts.secondAttestationBy === undefined ? second?.id ?? null : opts.secondAttestationBy,
    createdAt: new Date("2026-08-04T00:00:00Z"),
  });

  return { entity, claimant, evaluator, guardian, bountyId, claimId, submissionId, evaluationId, slug };
}
