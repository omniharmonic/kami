/**
 * Mood rules 1–7 (architecture §9.3), in order, first match wins, plus the
 * hysteresis rule. Mood is code, not prose: every `mood_reason` below is a
 * template with at most a band name or a class number filled in.
 *
 * Hysteresis (§9.3): "a mood change other than to `asleep` or `distressed`
 * takes effect only after two consecutive hourly snapshots agree."
 *
 * How the two-agree check works without a non-schema field: a snapshot
 * carries every input the rules read (paused, gpu_online, stale_driving,
 * alert_level, flood_category, drought_class, each need's health), so the
 * *candidate* mood of the previous snapshot is recomputed from the previous
 * snapshot itself (`candidateMoodFromSnapshot`) rather than read from a
 * stored field. The current candidate flips the published mood when it
 * equals that recomputed previous candidate, or when it is `asleep` or
 * `distressed` (always immediate). Otherwise the previous published mood and
 * reason are carried forward for one more hour. Two consecutive hourly
 * snapshots with the same candidate therefore flip the face; one noisy hour
 * does not.
 *
 * The one input a snapshot does not carry is the bounty flag (rule 6). It is
 * a 24 h window over hourly snapshots, so the flag an hour ago equals the
 * flag now except during the first hour after a completion; the previous
 * candidate is recomputed with the current flag. The visible effect: a
 * fresh `BountyCompleted` can turn `content` into `celebrating` within the
 * hour. That is deliberate — it is human-caused and the only path to
 * `celebrating` (PRD §6.3) — and it never shortcuts a change away from
 * `celebrating` or between the other moods.
 */

import type {
  AlertLevel,
  FloodCategory,
  HealthSnapshot,
  Mood,
  MoodResult,
  NeedName,
  NeedSnapshot,
  NwsAlert,
} from "./types.js";
import { defaultWeight } from "./types.js";

// ---------------------------------------------------------------------------
// Reason templates — the only strings this module can emit.
// ---------------------------------------------------------------------------

export const REASONS = {
  paused: "paused by my guardians",
  gpu_off: "my thinking machine is off",
  stale: "I can't feel my gauge",
  severe_alert: "a severe weather alert covers my watershed",
  alert: "a weather alert covers my watershed",
  flood: (cat: FloodCategory) => `${cat} flooding at my gauge`,
  flood_watch: (cat: FloodCategory) => `${cat} flood stage at my gauge`,
  drought: (dm: number) => `drought D${dm} in my watershed`,
  need_band: (need: NeedName, band: string | null) => `my ${need} reads ${band ?? "low"}`,
  mean_low: "my needs are running below normal",
  bounty: "a bounty was completed for me today",
  content: "my senses read normal",
} as const;

// ---------------------------------------------------------------------------
// alert_level from NWS severities
// ---------------------------------------------------------------------------

/** 3 if any Extreme/Severe; 2 if any Moderate; 1 if any Minor/Unknown alert present; 0 none. */
export function alertLevel(alerts: readonly NwsAlert[] | null | undefined): AlertLevel {
  if (!alerts || alerts.length === 0) return 0;
  let level: AlertLevel = 0;
  for (const a of alerts) {
    const s = a.severity;
    if (s === "Extreme" || s === "Severe") return 3;
    if (s === "Moderate") level = 2;
    else if (level < 1) level = 1; // Minor, Unknown, or anything else present
  }
  return level;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/** The fields the rules read. A HealthSnapshot satisfies this. */
export type MoodInputs = Pick<
  HealthSnapshot,
  "paused" | "gpu_online" | "stale_driving" | "alert_level" | "flood_category" | "drought_class"
> & { needs: readonly Pick<NeedSnapshot, "need" | "health" | "band">[] };

export type MoodContext = {
  /** a BountyCompleted attestation in the last 24 h (rule 6) */
  bounty_completed_in_24h: boolean;
  /**
   * weight per need (0–1). Needs with weight 0 do not drive mood; weights
   * scale the mean-health term. Defaults to `defaultWeight(need)`.
   */
  weights?: Partial<Record<NeedName, number>>;
};

const DISTRESS_HEALTH = 0.15;
const CONCERN_HEALTH = 0.35;
const CONCERN_MEAN = 0.5;

function weightOf(need: NeedName, ctx: MoodContext): number {
  const w = ctx.weights?.[need];
  const v = w === undefined ? defaultWeight(need) : w;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Needs that can drive mood: weight > 0 and a numeric health (stale and unbanded needs carry null). */
function drivingNeeds(inputs: MoodInputs, ctx: MoodContext) {
  const out: { need: NeedName; health: number; band: string | null; weight: number }[] = [];
  for (const n of inputs.needs) {
    const w = weightOf(n.need, ctx);
    if (w <= 0) continue;
    if (typeof n.health !== "number" || !Number.isFinite(n.health)) continue;
    out.push({ need: n.need, health: n.health, band: n.band, weight: w });
  }
  return out;
}

/**
 * Rules 1–7 with no hysteresis. Pure; safe to call on any snapshot.
 */
export function candidateMood(inputs: MoodInputs, ctx: MoodContext): MoodResult {
  // 1. paused / GPU off
  if (inputs.paused) return { mood: "asleep", reason: REASONS.paused };
  if (!inputs.gpu_online) return { mood: "asleep", reason: REASONS.gpu_off };

  // 2. stale on a driving need — never distressed (ADR-E11)
  if (inputs.stale_driving) return { mood: "asleep", reason: REASONS.stale };

  const flood = inputs.flood_category;
  const dm = inputs.drought_class;
  const driving = drivingNeeds(inputs, ctx);
  const worst = driving.reduce<(typeof driving)[number] | null>(
    (acc, n) => (acc === null || n.health < acc.health ? n : acc),
    null,
  );

  // 3. severe alert or moderate/major flood
  if (inputs.alert_level === 3) return { mood: "distressed", reason: REASONS.severe_alert };
  if (flood === "moderate" || flood === "major") return { mood: "distressed", reason: REASONS.flood(flood) };

  // 4. drought ≥ D2 or any need health ≤ 0.15
  if (dm !== null && dm >= 2) return { mood: "distressed", reason: REASONS.drought(dm) };
  if (worst && worst.health <= DISTRESS_HEALTH) {
    return { mood: "distressed", reason: REASONS.need_band(worst.need, worst.band) };
  }

  // 5. D1, alert_level 2, action/minor flood, any health ≤ 0.35, or mean ≤ 0.5
  if (dm === 1) return { mood: "concerned", reason: REASONS.drought(1) };
  if (inputs.alert_level === 2) return { mood: "concerned", reason: REASONS.alert };
  if (flood === "action" || flood === "minor") return { mood: "concerned", reason: REASONS.flood_watch(flood) };
  if (worst && worst.health <= CONCERN_HEALTH) {
    return { mood: "concerned", reason: REASONS.need_band(worst.need, worst.band) };
  }
  if (driving.length > 0) {
    const wsum = driving.reduce((s, n) => s + n.weight, 0);
    const mean = driving.reduce((s, n) => s + n.health * n.weight, 0) / wsum;
    if (mean <= CONCERN_MEAN) return { mood: "concerned", reason: REASONS.mean_low };
  }

  // 6. a BountyCompleted in the last 24 h — the only path to celebrating
  if (ctx.bounty_completed_in_24h) return { mood: "celebrating", reason: REASONS.bounty };

  // 7.
  return { mood: "content", reason: REASONS.content };
}

/** The candidate mood a published snapshot *would* have had (see header on the bounty flag). */
export function candidateMoodFromSnapshot(snapshot: HealthSnapshot, ctx: MoodContext): MoodResult {
  return candidateMood(snapshot, ctx);
}

/** Moods that always take effect immediately (§9.3). */
export function isImmediate(mood: Mood): boolean {
  return mood === "asleep" || mood === "distressed";
}

/**
 * Apply hysteresis. `candidate` is this hour's rule result; `previous` is the
 * latest published snapshot (or null on the first run). Returns the mood and
 * reason to publish.
 */
export function applyHysteresis(
  candidate: MoodResult,
  previous: HealthSnapshot | null | undefined,
  ctx: MoodContext,
): MoodResult {
  if (!previous) return candidate;
  if (candidate.mood === previous.mood) return candidate; // no change; reason may refresh
  if (isImmediate(candidate.mood)) return candidate;
  const prevCandidate = candidateMoodFromSnapshot(previous, ctx);
  if (prevCandidate.mood === candidate.mood) return candidate; // two consecutive hours agree
  return { mood: previous.mood, reason: previous.mood_reason }; // hold one more hour
}

/**
 * Rules 1–7 then hysteresis, in one call. `snapshotWithoutMood` is the
 * snapshot being built (everything but mood/mood_reason is final).
 */
export function computeMood(
  snapshotWithoutMood: MoodInputs,
  previous: HealthSnapshot | null | undefined,
  ctx: MoodContext,
): MoodResult {
  return applyHysteresis(candidateMood(snapshotWithoutMood, ctx), previous, ctx);
}

/** The most recent snapshot by `as_of`, or null. */
export function latestSnapshot(snapshots: readonly HealthSnapshot[] | undefined): HealthSnapshot | null {
  if (!snapshots || snapshots.length === 0) return null;
  let best: HealthSnapshot | null = null;
  for (const s of snapshots) {
    if (best === null || Date.parse(s.as_of) > Date.parse(best.as_of)) best = s;
  }
  return best;
}
