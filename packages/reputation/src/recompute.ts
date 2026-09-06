#!/usr/bin/env node
/**
 * kami-reputation-recompute — "anyone can recompute" (ADR-E06, 02 §8.3).
 *
 *   kami-reputation-recompute <scoresURI-or-file> [--eas-graphql <url>] [--offline bundle.json]
 *                             [--aux aux.json] [--passport-min <n>] [--json]
 *
 * Loads the published `reputation/<date>.json`, obtains the attestations it
 * lists (`inputs`) — from the EAS GraphQL indexer for Base (default
 * https://base.easscan.org/graphql, *verify* docs/verify.md #9) or from an
 * offline bundle `{attestations, predictions?, passport?, passport_min?}` — re-runs
 * `computeReputation` with `now = computed_at`, canonically serializes the
 * result and compares bytes with the canonical serialization of the published
 * file. Exit 0 when identical, 1 when they differ (a diff is printed), 2 on a
 * usage or I/O error.
 *
 * Two inputs of the function are not attestations and so cannot come from EAS:
 * the Human Passport map (drives `passport_ok`) and the tier-1 prediction
 * records (drive `entity_scores`). When a run does not supply them (no bundle
 * field / no --aux), those two fields are carried over from the published file
 * and the tool says so — the attestation-derived numbers (n, p, score, label,
 * inputs, root_of_uids) are always recomputed from scratch.
 */
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "./canonical.js";
import { DEFAULT_EAS_GRAPHQL_BASE, type FetchLike, loadAttestationsFromEas } from "./eas.js";
import {
  OfflineBundle,
  type OutcomeAttestation,
  type PredictionRecord,
  ReputationFile,
} from "./types.js";
import { computeReputation, DEFAULT_PASSPORT_MIN } from "./v1.js";

// ---------------------------------------------------------------------------
// Pure part (tested without a network or a filesystem)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliArgs {
  source: string;
  easGraphql: string;
  offline?: string;
  aux?: string;
  passportMin?: number;
  json: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let source: string | undefined;
  let easGraphql = DEFAULT_EAS_GRAPHQL_BASE;
  let offline: string | undefined;
  let aux: string | undefined;
  let passportMin: number | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${arg} needs a value`);
      return v;
    };
    if (arg === "--eas-graphql") easGraphql = next();
    else if (arg === "--offline") offline = next();
    else if (arg === "--aux") aux = next();
    else if (arg === "--passport-min") passportMin = Number(next());
    else if (arg === "--json") json = true;
    else if (arg === "-h" || arg === "--help") throw new UsageError();
    else if (arg.startsWith("-")) throw new UsageError(`unknown flag ${arg}`);
    else if (source === undefined) source = arg;
    else throw new UsageError(`unexpected argument ${arg}`);
  }
  if (source === undefined) throw new UsageError("missing <scoresURI-or-file>");
  const out: CliArgs = { source, easGraphql, json };
  if (offline !== undefined) out.offline = offline;
  if (aux !== undefined) out.aux = aux;
  if (passportMin !== undefined) out.passportMin = passportMin;
  return out;
}

export class UsageError extends Error {}

export const USAGE = `usage: kami-reputation-recompute <scoresURI-or-file> [--eas-graphql <url>] [--offline bundle.json]
                                 [--aux aux.json] [--passport-min <n>] [--json]

  <scoresURI-or-file>   http(s):// URL, file:// URL, or a local path to reputation/<date>.json
  --eas-graphql <url>   EAS GraphQL endpoint (default ${DEFAULT_EAS_GRAPHQL_BASE})
  --offline <file>      {attestations, predictions?, passport?, passport_min?} — no network
  --aux <file>          {predictions?, passport?, passport_min?} to pair with the EAS fetch
  --json                print the result object instead of a human summary

exit 0: byte-identical · 1: differs · 2: usage / I/O error`;

/** Read a local path, file:// URL or http(s) URL as text. */
export async function loadText(source: string, fetchImpl: FetchLike = fetch): Promise<string> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetchImpl(source, { headers: { "user-agent": "kami-reputation-recompute" } });
    if (!res.ok) throw new Error(`GET ${source} → HTTP ${res.status}`);
    return await res.text();
  }
  const path = source.startsWith("file://") ? new URL(source) : source;
  return await readFile(path, "utf8");
}

export interface RunDeps {
  fetchImpl?: FetchLike;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

/** The CLI body; returns the exit code. */
export async function run(argv: readonly string[], deps: RunDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(s + "\n"));
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      if (e.message) stderr(`error: ${e.message}`);
      stderr(USAGE);
      return 2;
    }
    throw e;
  }
  try {
    const published = ReputationFile.parse(JSON.parse(await loadText(args.source, deps.fetchImpl)));

    let attestations: OutcomeAttestation[];
    const aux: RecomputeAux = {};
    if (args.passportMin !== undefined) aux.passport_min = args.passportMin;

    if (args.offline !== undefined) {
      const bundle = OfflineBundle.parse(JSON.parse(await readFile(args.offline, "utf8")));
      attestations = bundle.attestations;
      if (bundle.predictions) aux.predictions = bundle.predictions;
      if (bundle.passport) aux.passport = new Map(Object.entries(bundle.passport));
      if (bundle.passport_min !== undefined && aux.passport_min === undefined) aux.passport_min = bundle.passport_min;
    } else {
      const known = new Set<string>();
      for (const s of published.scores) if (s.entity !== null) known.add(s.entity);
      for (const e of published.entity_scores) known.add(e.entity);
      attestations = await loadAttestationsFromEas(published.inputs, args.easGraphql, {
        knownEntities: [...known],
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      const missing = published.inputs.filter((u) => !attestations.some((a) => a.uid === u));
      if (missing.length) stderr(`warning: ${missing.length} listed UID(s) not returned by ${args.easGraphql}: ${missing.join(", ")}`);
    }
    if (args.aux !== undefined) {
      const extra = OfflineBundle.omit({ attestations: true }).parse(JSON.parse(await readFile(args.aux, "utf8")));
      if (extra.predictions) aux.predictions = extra.predictions;
      if (extra.passport) aux.passport = new Map(Object.entries(extra.passport));
      if (extra.passport_min !== undefined && aux.passport_min === undefined) aux.passport_min = extra.passport_min;
    }

    const result = recomputeFromInputs(published, attestations, aux);
    if (args.json) {
      stdout(JSON.stringify({ identical: result.identical, carried: result.carried, diff: result.diff }, null, 2));
    } else {
      const bytes = new TextEncoder().encode(result.recomputedJson).length;
      stdout(`${published.function} · computed_at ${published.computed_at} · ${published.inputs.length} input UID(s) · ${attestations.length} attestation(s) loaded`);
      if (result.carried.length) stdout(`carried from the published file (inputs not supplied): ${result.carried.join(", ")}`);
      if (result.identical) stdout(`IDENTICAL — ${bytes} canonical bytes reproduced; root_of_uids ${result.recomputed.root_of_uids}`);
      else stdout(`DIFFERS — ${result.diff.length} difference(s):\n${formatDiff(result.diff)}`);
    }
    return result.identical ? 0 : 1;
  } catch (e) {
    stderr(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

/**
 * True when this file is the process entry point. Node realpaths the main
 * module for `import.meta.url` but leaves `process.argv[1]` as typed, so a
 * `node_modules/.bin` symlink (how `kami-reputation-recompute` is invoked)
 * must be realpath'd too or the CLI would silently do nothing.
 */
function isMainModule(): boolean {
  const argv1 = typeof process !== "undefined" ? process.argv[1] : undefined;
  if (argv1 === undefined) return false;
  let resolved = argv1;
  try {
    resolved = realpathSync(argv1);
  } catch {
    /* keep argv1 */
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

const invokedDirectly = isMainModule();

if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      process.exit(2);
    },
  );
}
