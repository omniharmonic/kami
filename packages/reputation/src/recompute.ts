/**
 * reputation/v1 recompute — the pure half.
 *
 * `recomputeFromInputs` re-runs `computeReputation` over the attestations a
 * published `reputation/<date>.json` lists and compares canonical bytes with
 * the published file. It touches no filesystem and no network, which is why it
 * lives apart from the CLI: `@kami/reputation` is imported by the web app, and
 * a dynamic `readFile` anywhere in that import graph makes Next trace the whole
 * repository into the serverless bundle.
 *
 * The command-line tool that reads files and queries EAS is
 * `@kami/reputation/cli` (`kami-reputation-recompute`).
 *
 * Two inputs of the function are not attestations and so cannot come from EAS:
 * the Human Passport map (drives `passport_ok`) and the tier-1 prediction
 * records (drive `entity_scores`). When a run does not supply them, those two
 * fields are carried over from the published file and `carried` says so — the
 * attestation-derived numbers (n, p, score, label, inputs, root_of_uids) are
 * always recomputed from scratch.
 */
import { canonicalJson } from "./canonical.js";
import {
  type OutcomeAttestation,
  type PredictionRecord,
  ReputationFile,
} from "./types.js";
import { computeReputation, DEFAULT_PASSPORT_MIN } from "./v1.js";

export interface RecomputeAux {
  predictions?: PredictionRecord[];
  passport?: Map<string, number>;
  passport_min?: number;
}

export interface RecomputeResult {
  identical: boolean;
  publishedJson: string;
  recomputedJson: string;
  recomputed: ReputationFile;
  /** Fields copied from the published file because their inputs were not supplied. */
  carried: ("passport_ok" | "entity_scores")[];
  diff: JsonDiff[];
}

export interface JsonDiff {
  path: string;
  published: unknown;
  recomputed: unknown;
}

/**
 * Re-run the function over `attestations` with `now = published.computed_at`
 * and compare canonical bytes.
 */
export function recomputeFromInputs(
  published: ReputationFile,
  attestations: readonly OutcomeAttestation[],
  aux: RecomputeAux = {},
): RecomputeResult {
  const carried: RecomputeResult["carried"] = [];

  let passport = aux.passport;
  if (passport === undefined) {
    // Carry `passport_ok` over: subjects flagged ok get exactly passport_min.
    carried.push("passport_ok");
    const min = aux.passport_min ?? DEFAULT_PASSPORT_MIN;
    passport = new Map<string, number>();
    for (const s of published.scores) {
      if (s.entity === null) passport.set(s.subject, s.passport_ok ? min : Number.NEGATIVE_INFINITY);
    }
  }

  const recomputed = computeReputation(attestations, {
    now: published.computed_at,
    passport,
    ...(aux.passport_min !== undefined ? { passport_min: aux.passport_min } : {}),
    ...(aux.predictions !== undefined ? { predictions: aux.predictions } : {}),
  });
  if (aux.predictions === undefined) {
    carried.push("entity_scores");
    recomputed.entity_scores = structuredClone(published.entity_scores);
  }

  const publishedJson = canonicalJson(published);
  const recomputedJson = canonicalJson(recomputed);
  const identical = publishedJson === recomputedJson;
  return {
    identical,
    publishedJson,
    recomputedJson,
    recomputed,
    carried,
    diff: identical ? [] : diffJson(published, recomputed),
  };
}

/** Path-level structural diff of two JSON values (published vs recomputed). */
export function diffJson(a: unknown, b: unknown, path = "$", out: JsonDiff[] = []): JsonDiff[] {
  if (canonicalJson(a) === canonicalJson(b)) return out;
  const aObj = a !== null && typeof a === "object";
  const bObj = b !== null && typeof b === "object";
  if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path, published: a, recomputed: b });
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) diffJson(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort()) {
    diffJson(ao[k], bo[k], `${path}.${k}`, out);
  }
  return out;
}

export function formatDiff(diff: readonly JsonDiff[], max = 50): string {
  const lines = diff.slice(0, max).map(
    (d) => `  ${d.path}\n    published:  ${JSON.stringify(d.published)}\n    recomputed: ${JSON.stringify(d.recomputed)}`,
  );
  if (diff.length > max) lines.push(`  … ${diff.length - max} more`);
  return lines.join("\n");
}
