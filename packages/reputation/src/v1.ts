/**
 * reputation/v1 — 02 §8.3, implemented exactly.
 *
 * For a subject s (a user, or an entity for its own predictions) and an entity
 * e, over all non-revoked `ProposalOutcome` attestations where s is the claimant:
 *
 *   w_i     = decay(age_i) × tier_i × stake_i
 *   decay   = 0.5 ^ (age_days / 365)                     (age clamped at ≥ 0)
 *   tier    = {1: 1.0, 2: 1.0, 3: 0.4, 4: 0.6 until the follow-up outcome exists, then 1.0}
 *   stake   = 1 + ln(1 + usd_i / 25)
 *   success = {succeeded: 1, partial: 0.5, failed: 0, unverifiable: excluded}
 *   n       = Σ w_i
 *   p       = Σ w_i·success_i / n
 *   score   = Wilson lower bound at z = 1.96 on (p, n), × 100;  n < 1 ⇒ "new"
 *
 * Cross-entity score = the n-weighted mean over the subject's entity rows.
 * Nothing pools across sibling entities for an entity's own score. The entity's
 * own score is the fraction of its tier-1 predictions whose named
 * place/property moved in the predicted direction within the window.
 *
 * Everything here is pure and deterministic: the same attestations, predictions,
 * passport map and `now` produce the same ReputationFile, and canonicalJson of
 * that file produces the same bytes. That is the whole point (ADR-E06).
 */
import { concat, type Hex, keccak256 } from "viem";
import { canonicalJson } from "./canonical.js";
import { Outcome } from "./schemas.js";
import {
  type ComputeOptions,
  type EntityScore,
  type OutcomeAttestation,
  type PredictionRecord,
  REPUTATION_FUNCTION_ID,
  type ReputationFile,
  type Score,
  type Uid,
} from "./types.js";

export const WILSON_Z = 1.96;
export const DECAY_HALF_LIFE_DAYS = 365;
export const STAKE_SCALE_USD = 25;
export const NEW_THRESHOLD_N = 1;
export const DEFAULT_PASSPORT_MIN = 20;
/** Published numbers are rounded to this many decimals — stable across engines. */
export const OUTPUT_DECIMALS = 6;

export const TIER_WEIGHT = {
  1: 1.0,
  2: 1.0,
  3: 0.4,
  4: 0.6,
} as const;
/** Tier-4 weight once the follow-up (balance) outcome exists. */
export const TIER4_FOLLOWED_UP_WEIGHT = 1.0;

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Building blocks (exported so tests and the UI can show their work)
// ---------------------------------------------------------------------------

/** `0.5 ^ (age_days / 365)`; negative ages (clock skew) are clamped to 0. */
export function decay(ageDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / DECAY_HALF_LIFE_DAYS);
}

/** `1 + ln(1 + usd / 25)`. */
export function stakeWeight(usd: number): number {
  return 1 + Math.log(1 + usd / STAKE_SCALE_USD);
}

/** `success_i`; null means "excluded" (unverifiable). */
export function successOf(outcome: OutcomeAttestation["outcome"]): number | null {
  switch (outcome) {
    case Outcome.succeeded:
      return 1;
    case Outcome.partial:
      return 0.5;
    case Outcome.failed:
      return 0;
    case Outcome.unverifiable:
      return null;
  }
}

/**
 * Wilson score interval, lower bound, for an observed proportion `p` over a
 * (real-valued) sample size `n`:
 *
 *   LB = ( p + z²/2n − z·√( p(1−p)/n + z²/4n² ) ) / ( 1 + z²/n )
 *
 * With z = 1.96 this is the lower end of the ~95% interval. `n` here is Σ w_i,
 * not a count — the weights already carry decay, tier and stake — and the
 * formula is applied with that real number as the sample size, exactly as
 * 02 §8.3 specifies. Result is clamped to [0, 1]; the published score is ×100.
 */
export function wilsonLowerBound(p: number, n: number, z = WILSON_Z): number {
  if (!(n > 0)) return 0;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const lb = (centre - margin) / (1 + z2 / n);
  return Math.min(1, Math.max(0, lb));
}

/** Round to OUTPUT_DECIMALS; `-0` normalized to `0`. */
export function round(x: number): number {
  const f = 10 ** OUTPUT_DECIMALS;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function toDate(now: Date | string | number): Date {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) throw new TypeError(`invalid date: ${String(now)}`);
  return d;
}

/**
 * Per-attestation weight. `followedUp` is the set of UIDs that some other
 * non-revoked attestation names in `follow_up_of`.
 */
export function weightOf(
  a: OutcomeAttestation,
  nowMs: number,
  followedUp: ReadonlySet<Uid>,
): number {
  const ageDays = (nowMs - Date.parse(a.attested_at)) / MS_PER_DAY;
  let tier: number = TIER_WEIGHT[a.verification_tier];
  if (a.verification_tier === 4 && (a.follow_up_of !== undefined || followedUp.has(a.uid))) {
    tier = TIER4_FOLLOWED_UP_WEIGHT;
  }
  return decay(ageDays) * tier * stakeWeight(a.usd_at_stake);
}

// ---------------------------------------------------------------------------
// Merkle root
// ---------------------------------------------------------------------------

/**
 * `rootOfUIDs` — the value carried by the weekly `ReputationSnapshot`. To
 * recompute it from a published file:
 *
 *  1. take `inputs`, lowercase each UID, de-duplicate, sort lexicographically;
 *  2. the leaves are the UIDs themselves (already 32 bytes) — no extra hashing;
 *  3. build levels bottom-up: pair adjacent nodes left-to-right and hash
 *     `keccak256(left ‖ right)` (64 bytes in); when a level has an odd count,
 *     the last node is paired with a copy of itself;
 *  4. repeat until one node remains — that is the root.
 *
 * Edge cases: an empty list roots to `0x00…00` (32 zero bytes); a single UID
 * roots to itself. Output is lowercase hex.
 */
export function merkleRootOfUids(uids: readonly string[]): Hex {
  let level: Hex[] = [...new Set(uids.map((u) => u.toLowerCase()))].sort() as Hex[];
  for (const u of level) {
    if (!/^0x[0-9a-f]{64}$/.test(u)) throw new TypeError(`merkleRootOfUids: not a bytes32 uid: ${u}`);
  }
  if (level.length === 0) return `0x${"0".repeat(64)}`;
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(keccak256(concat([left, right])));
    }
    level = next;
  }
  return level[0]!;
}

// ---------------------------------------------------------------------------
// The function
// ---------------------------------------------------------------------------

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Acc {
  n: number;
  num: number;
}

/**
 * The entity's own score: fraction of tier-1 predictions whose observed
 * direction equals the predicted direction. Only predictions whose window has
 * closed (`window_end ≤ now`) AND that have an observed direction count;
 * unresolved ones are excluded from both numerator and denominator.
 */
export function computeEntityScores(
  predictions: readonly PredictionRecord[],
  nowMs: number,
): EntityScore[] {
  const byEntity = new Map<string, { n: number; correct: number }>();
  for (const pr of predictions) {
    const acc = byEntity.get(pr.entity) ?? { n: 0, correct: 0 };
    byEntity.set(pr.entity, acc);
    if (pr.observed_direction === null) continue;
    if (Date.parse(pr.window_end) > nowMs) continue;
    acc.n += 1;
    if (pr.observed_direction === pr.direction) acc.correct += 1;
  }
  return [...byEntity.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([entity, { n, correct }]) => ({
      entity,
      predictions_n: n,
      correct_n: correct,
      accuracy: n === 0 ? null : round(correct / n),
    }));
}

/**
 * Compute the reputation file. Pure: no clock, no I/O, no randomness.
 *
 * Ordering is fully determined: `inputs` sorted; `scores` sorted by subject,
 * then by entity with the cross-entity row (`entity: null`) first;
 * `entity_scores` sorted by entity.
 */
export function computeReputation(
  attestations: readonly OutcomeAttestation[],
  opts: ComputeOptions,
): ReputationFile {
  const now = toDate(opts.now);
  const nowMs = now.getTime();
  const passport = opts.passport ?? new Map<string, number>();
  const passportMin = opts.passport_min ?? DEFAULT_PASSPORT_MIN;

  const inputs = [...new Set(attestations.map((a) => a.uid.toLowerCase() as Uid))].sort();

  const live = attestations.filter((a) => !a.revoked);
  const followedUp = new Set<Uid>();
  for (const a of live) {
    if (a.follow_up_of !== undefined) followedUp.add(a.follow_up_of.toLowerCase() as Uid);
  }

  // subject → entity → accumulator
  const bySubject = new Map<string, Map<string, Acc>>();
  for (const a of live) {
    const success = successOf(a.outcome);
    if (success === null) continue; // unverifiable: excluded
    const w = weightOf(a, nowMs, followedUp);
    let entities = bySubject.get(a.subject);
    if (!entities) bySubject.set(a.subject, (entities = new Map()));
    let acc = entities.get(a.entity_id);
    if (!acc) entities.set(a.entity_id, (acc = { n: 0, num: 0 }));
    acc.n += w;
    acc.num += w * success;
  }

  const scores: Score[] = [];
  for (const subject of [...bySubject.keys()].sort(cmp)) {
    const entities = bySubject.get(subject)!;
    const passportScore = passport.get(subject);
    const passport_ok = passportScore !== undefined && passportScore >= passportMin;

    const rows: Score[] = [];
    let totalN = 0;
    let totalNum = 0;
    let scoredN = 0;
    let scoredSum = 0;
    for (const entity of [...entities.keys()].sort(cmp)) {
      const { n, num } = entities.get(entity)!;
      const p = n > 0 ? num / n : null;
      const isNew = n < NEW_THRESHOLD_N;
      const score = isNew || p === null ? null : wilsonLowerBound(p, n) * 100;
      rows.push({
        subject,
        entity,
        n: round(n),
        p: p === null ? null : round(p),
        score: score === null ? null : round(score),
        passport_ok,
        label: score === null ? "new" : null,
      });
      totalN += n;
      totalNum += num;
      if (score !== null) {
        scoredN += n;
        scoredSum += n * score;
      }
    }

    // Cross-entity row: n-weighted mean of the entity scores that exist.
    const crossScore = scoredN > 0 ? scoredSum / scoredN : null;
    scores.push({
      subject,
      entity: null,
      n: round(totalN),
      p: totalN > 0 ? round(totalNum / totalN) : null,
      score: crossScore === null ? null : round(crossScore),
      passport_ok,
      label: crossScore === null ? "new" : null,
    });
    scores.push(...rows);
  }

  return {
    function: REPUTATION_FUNCTION_ID,
    computed_at: now.toISOString(),
    inputs,
    scores,
    entity_scores: computeEntityScores(opts.predictions ?? [], nowMs),
    root_of_uids: merkleRootOfUids(inputs),
  };
}

// ---------------------------------------------------------------------------
// Nightly writer
// ---------------------------------------------------------------------------

/** The exact bytes the nightly job publishes as `reputation/<date>.json`. */
export function renderReputationFile(file: ReputationFile): string {
  return canonicalJson(file);
}

/**
 * What the nightly job calls: compute, then serialize canonically. Returns the
 * file and its bytes; the caller uploads the bytes to R2 and, weekly, attests
 * `root_of_uids` + the scoresURI as a `ReputationSnapshot`.
 */
export function buildNightlyFile(
  attestations: readonly OutcomeAttestation[],
  opts: ComputeOptions,
): { file: ReputationFile; json: string } {
  const file = computeReputation(attestations, opts);
  return { file, json: renderReputationFile(file) };
}

/** Write the nightly file to disk (used by tests and local runs). */
export async function writeNightlyFile(
  path: string,
  attestations: readonly OutcomeAttestation[],
  opts: ComputeOptions,
): Promise<{ file: ReputationFile; json: string }> {
  const built = buildNightlyFile(attestations, opts);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, built.json, "utf8");
  return built;
}
