/**
 * The nightly reputation job (architecture §8.3, plan T2.13): gather
 * `ProposalOutcome` attestations from the local index joined with the rows
 * that explain them, the Passport map, and tier-1 predictions with their
 * observed direction; run `computeReputation`; publish `reputation/<date>.json`;
 * record `reputation_runs` + `reputation_scores`; on Sundays attest a
 * `ReputationSnapshot` per entity. `recomputeFromInputs` must reproduce the
 * published file byte-for-byte — the test asserts it.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  Outcome,
  REPUTATION_FUNCTION_ID,
  buildNightlyFile,
  type OutcomeAttestation,
  type PredictionRecord,
  type ReputationFile,
} from "@kami/reputation";
import { entityIdOf, type SchemaItem } from "@kami/chain";
import { keccak256, stringToBytes, type Hex } from "viem";
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { activeEntities, getConfig } from "@/lib/jobs/common";
import { CACHE_CONTROL, type Publisher } from "@/lib/publish";
import { attest } from "@/lib/signing/attester";
import { bytes32 } from "@/lib/signing/validate";
import { eligibleOutcomeUid } from "@/lib/governance/attest";
import type { TreasuryDeps } from "./deps";

export type Direction = "up" | "down";
export type PredictionQuery = { place_id: string; property: string; window_start: string | null; window_end: string };
export type DirectionResolver = (q: PredictionQuery) => Promise<Direction | null>;

export type ReputationInputs = {
  attestations: OutcomeAttestation[];
  passport: Map<string, number>;
  passport_min: number;
  predictions: PredictionRecord[];
};

const OUTCOME_CODE: Record<string, 0 | 1 | 2 | 3> = { succeeded: Outcome.succeeded, partial: Outcome.partial, failed: Outcome.failed, unverifiable: Outcome.unverifiable };

/** The subject key the reputation function sees: the wallet when known, else the user id. */
export function subjectOf(user: { id: string; walletAddress: string | null }): string {
  return user.walletAddress ? user.walletAddress.toLowerCase() : user.id;
}

export async function gatherReputationInputs(db: Db, opts: { now: Date; resolveDirection?: DirectionResolver }): Promise<ReputationInputs> {
  // Every evaluation with a ProposalOutcome UID (onchain or offchain), joined to what explains it.
  const rows = await db
    .select({
      evaluation: schema.evaluations,
      bounty: schema.bounties,
      user: { id: schema.users.id, walletAddress: schema.users.walletAddress },
      entity: { id: schema.entities.id, slug: schema.entities.slug },
      attestation: schema.attestations,
    })
    .from(schema.evaluations)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.evaluations.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.users, eq(schema.users.id, schema.claims.userId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .innerJoin(schema.entities, eq(schema.entities.id, schema.bounties.entityId))
    .leftJoin(
      schema.attestations,
      sql`lower(${schema.attestations.uid}) = lower(coalesce(${schema.evaluations.easUid}, ${schema.evaluations.offchainAttestation} ->> 'uid'))`,
    )
    .where(sql`coalesce(${schema.evaluations.easUid}, ${schema.evaluations.offchainAttestation} ->> 'uid') is not null`);

  const attestations: OutcomeAttestation[] = [];
  for (const r of rows) {
    const uid = eligibleOutcomeUid(r.evaluation.easUid, r.evaluation.offchainAttestation);
    if (!uid) continue;
    const tier = r.bounty.verificationTier;
    if (tier < 1 || tier > 4) continue;
    const proposalHash = bytes32(r.bounty.specSha256) ?? keccak256(stringToBytes(r.bounty.id));
    const attestedAt = r.evaluation.attestedAt ?? r.attestation?.createdAt ?? r.evaluation.createdAt ?? opts.now;
    const followUp = tier === 4 && r.attestation?.refUid ? bytes32(r.attestation.refUid) : null;
    attestations.push({
      uid,
      entity_id: r.entity.id,
      proposal_hash: proposalHash,
      subject: subjectOf(r.user),
      outcome: OUTCOME_CODE[r.evaluation.outcome] ?? Outcome.unverifiable,
      verification_tier: tier as 1 | 2 | 3 | 4,
      usd_at_stake: Number(r.bounty.capUsdc),
      attested_at: attestedAt.toISOString(),
      ...(followUp ? { follow_up_of: followUp } : {}),
      revoked: Boolean(r.attestation?.revokedAt),
    });
  }

  const passport = new Map<string, number>();
  const users = await db
    .select({ id: schema.users.id, walletAddress: schema.users.walletAddress, score: schema.users.passportScore })
    .from(schema.users)
    .where(isNotNull(schema.users.passportScore));
  for (const u of users) {
    const n = Number(u.score);
    if (Number.isFinite(n)) passport.set(subjectOf(u), n);
  }
  const passport_min = Number((await getConfig<number>(db, "passport_min")) ?? 20);

  const predictions: PredictionRecord[] = [];
  const predRows = await db
    .select({ bounty: schema.bounties, slug: schema.entities.slug })
    .from(schema.bounties)
    .innerJoin(schema.entities, eq(schema.entities.id, schema.bounties.entityId))
    .where(and(eq(schema.bounties.verificationTier, 1), isNotNull(schema.bounties.prediction)));
  for (const { bounty, slug } of predRows) {
    // `bounties.prediction` shape is WP9's (*verify*): {place_id, property, direction, window_end, window_start?}
    const p = bounty.prediction as { place_id?: unknown; property?: unknown; direction?: unknown; window_end?: unknown; window_start?: unknown } | null;
    if (!p || typeof p.place_id !== "string" || typeof p.property !== "string" || (p.direction !== "up" && p.direction !== "down") || typeof p.window_end !== "string") continue;
    const window_end = new Date(p.window_end);
    if (Number.isNaN(window_end.getTime())) continue;
    const window_start = typeof p.window_start === "string" ? p.window_start : (bounty.createdAt?.toISOString() ?? null);
    let observed: Direction | null = null;
    if (opts.resolveDirection && window_end.getTime() <= opts.now.getTime()) {
      try {
        observed = await opts.resolveDirection({ place_id: p.place_id, property: p.property, window_start, window_end: window_end.toISOString() });
      } catch {
        observed = null; // stale or absent readings ⇒ unknown, never a miss
      }
    }
    predictions.push({ entity: `entity/${slug}`, place_id: p.place_id, property: p.property, direction: p.direction, window_end: window_end.toISOString(), observed_direction: observed });
  }

  return { attestations, passport, passport_min, predictions };
}

/**
 * Observed direction from the twin's place page series: the last reading in
 * the window against the first. Fewer than two points, or no movement, is
 * `null` (unknown) — nothing is interpolated.
 */
export function directionFromSeries(series: { t: string[]; v: (number | null)[] }, windowStart: string | null, windowEnd: string): Direction | null {
  const start = windowStart ? Date.parse(windowStart) : Number.NEGATIVE_INFINITY;
  const end = Date.parse(windowEnd);
  const pts: number[] = [];
  for (let i = 0; i < series.t.length; i++) {
    const t = Date.parse(series.t[i]!);
    const v = series.v[i];
    if (v === null || v === undefined || !Number.isFinite(t) || t < start || t > end) continue;
    pts.push(v);
  }
  if (pts.length < 2) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (last > first) return "up";
  if (last < first) return "down";
  return null;
}

/** Default resolver over WP7's shared twin client (`placePage` series keyed by datastream). */
export function twinDirectionResolver(): DirectionResolver {
  return async (q) => {
    const { getTwinClient } = await import("@/lib/jobs/twin");
    const page = await getTwinClient().placePage(q.place_id);
    if (!page) return null;
    const series = Object.values(page.data.series).find((s) => s.property === q.property);
    if (!series) return null;
    return directionFromSeries(series, q.window_start, q.window_end);
  };
}

export function reputationKey(date: string): string {
  return `reputation/${date}.json`;
}

export function reputationUri(env: TreasuryDeps["env"], key: string): string {
  const base = (env.KAMI_DATA_BASE_URL ?? "kami-data:/").replace(/\/$/, "");
  return `${base}/${key}`;
}

export type ReputationRunResult = {
  run_id: string;
  key: string;
  scores_uri: string;
  file: ReputationFile;
  json: string;
  inputs: number;
  scores: number;
  snapshot_uids: Array<{ entity: string; uid: Hex }>;
};

export async function runReputation(
  db: Db,
  deps: TreasuryDeps,
  opts: { publisher: Publisher; resolveDirection?: DirectionResolver; snapshot?: boolean },
): Promise<ReputationRunResult> {
  const now = deps.now();
  const inputs = await gatherReputationInputs(db, { now, resolveDirection: opts.resolveDirection ?? twinDirectionResolver() });
  const { file, json } = buildNightlyFile(inputs.attestations, { now, passport: inputs.passport, passport_min: inputs.passport_min, predictions: inputs.predictions });

  const date = now.toISOString().slice(0, 10);
  const key = reputationKey(date);
  await opts.publisher.put(key, json, { contentType: "application/json", cacheControl: CACHE_CONTROL.id });
  const scoresUri = reputationUri(deps.env, key);
  const runId = `rep_${date}`;

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.reputationRuns)
      .values({ id: runId, functionVersion: REPUTATION_FUNCTION_ID, computedAt: now, uids: file.inputs, rootOfUids: file.root_of_uids, scoresUri })
      .onConflictDoUpdate({ target: schema.reputationRuns.id, set: { computedAt: now, uids: file.inputs, rootOfUids: file.root_of_uids, scoresUri } });
    await tx.delete(schema.reputationScores).where(eq(schema.reputationScores.runId, runId));
    if (file.scores.length) {
      await tx.insert(schema.reputationScores).values(
        file.scores.map((s) => ({
          runId,
          subject: s.subject,
          // the cross-entity row (`entity: null` in the file) is stored under "*": entity_id is in the PK
          entityId: s.entity ?? "*",
          n: String(s.n),
          p: s.p === null ? null : String(s.p),
          score: s.score === null ? null : String(s.score),
          passportOk: s.passport_ok,
        })),
      );
    }
  });

  const snapshotUids: Array<{ entity: string; uid: Hex }> = [];
  const isSunday = now.getUTCDay() === 0;
  if (opts.snapshot ?? isSunday) {
    const entities = await activeEntities(db);
    const attester = await (await deps.backend()).getAddress("attester");
    for (const e of entities) {
      try {
        const data: SchemaItem[] = [
          { name: "entityId", value: entityIdOf(e.slug), type: "bytes32" },
          { name: "rootOfUIDs", value: file.root_of_uids, type: "bytes32" },
          { name: "scoresURI", value: scoresUri, type: "string" },
          { name: "computedAt", value: BigInt(Math.floor(now.getTime() / 1000)), type: "uint64" },
        ];
        const a = await attest(deps, { schemaName: "ReputationSnapshot", data });
        snapshotUids.push({ entity: e.slug, uid: a.uid });
        await db.transaction(async (tx) => {
          await tx
            .insert(schema.attestations)
            .values({ uid: a.uid, schema: "ReputationSnapshot", mode: "onchain", attester, entityId: e.id, payload: { run_id: runId, root_of_uids: file.root_of_uids, scores_uri: scoresUri, computed_at: now.toISOString() }, createdAt: now })
            .onConflictDoNothing();
          await appendEntityEvent(tx, { entity_id: e.id, actor: "attester", kind: "reputation.snapshot", payload: { uid: a.uid, run_id: runId, root_of_uids: file.root_of_uids }, at: now });
        });
      } catch (err) {
        deps.log(`ReputationSnapshot for ${e.slug} failed: ${(err as Error).message}`);
      }
    }
    if (snapshotUids[0]) await db.update(schema.reputationRuns).set({ easUidSnapshot: snapshotUids[0].uid }).where(eq(schema.reputationRuns.id, runId));
  }

  return { run_id: runId, key, scores_uri: scoresUri, file, json, inputs: file.inputs.length, scores: file.scores.length, snapshot_uids: snapshotUids };
}
