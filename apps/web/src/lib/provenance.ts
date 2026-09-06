/**
 * Where the model that answers for a kami actually runs.
 *
 * The "how I work" page used to *assert* "a small open-weights model on a
 * single rented GPU … no frontier model is on the hot path". That sentence was
 * hardcoded, so it stayed on the page whether or not it was true — and it stops
 * being true the moment an operator points the gate at a hosted,
 * OpenAI-compatible API while the project's own hardware is pending. On a
 * platform whose whole thesis is that it never says what it cannot back up, a
 * page claiming local inference while someone else's API answers the chat is
 * worse than a wrong number: it is a false claim about the system's own
 * integrity.
 *
 * So this module reports instead of asserting. The gate — the proxy every
 * request passes through — posts `{placement, provider, model, at}` to
 * `POST /api/gate/provenance`, which stores it in the `config` table under
 * `gate_provenance.<slug>`, falling back to `gate_provenance.default` for a box
 * serving every kami from one upstream. This module reads that report, prefers
 * it over anything on disk, falls back to the Hermes profile config (which is a
 * *request* for a model, not a measurement of one), and otherwise says it does
 * not know.
 *
 * Staleness follows the twin's rule (CLAUDE.md): a reading whose time is old is
 * shown as last-known with its timestamp, never as current fact. Absent means
 * unknown, never a flattering default.
 */
import { inArray } from "drizzle-orm";
import { withDb } from "@/db/client";
import * as schema from "@/db/schema";
import { servingModel } from "./entities";

/** Where the serving box is, from the gate's point of view. */
export type Placement = "owned" | "rented" | "hosted";

export const PLACEMENTS: readonly Placement[] = ["owned", "rented", "hosted"] as const;

/**
 * Which source the answer came from:
 * - `gate`    — the live report from the proxy every request passes through. Authoritative.
 * - `profile` — the Hermes profile config on disk. Names a model, says nothing about placement.
 * - `unknown` — nothing has reported. The page claims nothing.
 */
export type ProvenanceSource = "gate" | "profile" | "unknown";

export type Provenance = {
  /** null unless the gate reported one — a profile on disk cannot know it. */
  placement: Placement | null;
  provider: string | null;
  model: string | null;
  /** ISO-8601 instant of the gate's report; null when there is no timed report. */
  at: string | null;
  source: ProvenanceSource;
  /**
   * true only when there *is* a timestamp and it is older than the window.
   * Absence of a report is carried by `source`, not by this flag — an unknown
   * provenance is unknown, not stale.
   */
  stale: boolean;
  /** Seconds since `at`; null when there is no timestamp (absent, never zero). */
  staleness_s: number | null;
  /** From the profile only; the gate does not report it. */
  reasoning_effort: string | null;
};

/** A report older than this is shown as last-known, with its timestamp. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const provenanceKey = (slug: string): string => `gate_provenance.${slug}`;
export const PROVENANCE_DEFAULT_KEY = "gate_provenance.default";

/** True when `at` is missing, unparseable, or older than `maxAgeMs`. */
export function isStale(at: string | null | undefined, now: number = Date.now(), maxAgeMs: number = MAX_AGE_MS): boolean {
  if (typeof at !== "string") return true;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return true;
  return now - t > maxAgeMs;
}

/** Seconds since `at`, or null when there is no usable timestamp. */
export function stalenessSeconds(at: string | null | undefined, now: number = Date.now()): number | null {
  if (typeof at !== "string") return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

type GateReport = { placement: Placement | null; provider: string | null; model: string | null; at: string | null };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Validate one stored report. Anything malformed is treated as no report at
 * all: a half-read row must never become a claim on the page.
 */
export function parseGateReport(value: unknown): GateReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const placementRaw = str(v.placement);
  const placement = placementRaw && (PLACEMENTS as readonly string[]).includes(placementRaw) ? (placementRaw as Placement) : null;
  const model = str(v.model);
  const at = str(v.at);
  // A report that names neither a placement nor a model says nothing.
  if (!placement && !model) return null;
  return {
    placement,
    provider: str(v.provider),
    model,
    at: at && Number.isFinite(Date.parse(at)) ? at : null,
  };
}

/** The gate's own report for this kami, or the box-wide default, or null. */
async function gateReport(slug: string): Promise<GateReport | null> {
  const keys = [provenanceKey(slug), PROVENANCE_DEFAULT_KEY];
  return withDb(async (db) => {
    const rows = await db.select().from(schema.config).where(inArray(schema.config.key, keys));
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    for (const key of keys) {
      const parsed = parseGateReport(byKey.get(key));
      if (parsed) return parsed;
    }
    return null;
  }, null);
}

export const UNKNOWN_PROVENANCE: Provenance = {
  placement: null,
  provider: null,
  model: null,
  at: null,
  source: "unknown",
  stale: false,
  staleness_s: null,
  reasoning_effort: null,
};

/**
 * What is serving `slug`, and how we know. Never invents: the gate wins, the
 * profile is a fallback that can only name a model, and "unknown" is a real
 * answer the page is expected to print.
 */
export async function servingProvenance(slug: string, now: number = Date.now()): Promise<Provenance> {
  const gate = await gateReport(slug);
  if (gate) {
    return {
      ...gate,
      source: "gate",
      stale: gate.at === null ? false : isStale(gate.at, now),
      staleness_s: stalenessSeconds(gate.at, now),
      reasoning_effort: null,
    };
  }
  const profile = await servingModel(slug);
  if (profile) {
    return {
      placement: null,
      provider: null,
      model: profile.name,
      at: null,
      source: "profile",
      stale: false,
      staleness_s: null,
      reasoning_effort: profile.reasoning_effort,
    };
  }
  return UNKNOWN_PROVENANCE;
}

/**
 * The single question the page's biggest claim depends on: may we say "no
 * frontier model is on the hot path"? Only when the gate has reported, recently,
 * that the weights run on a GPU this project owns or rents (PRD §3 non-goals,
 * ADR-E03). A hosted API, an unknown placement, or a stale report — no claim.
 */
export function mayClaimNoFrontierModel(p: Provenance): boolean {
  return p.source === "gate" && !p.stale && (p.placement === "owned" || p.placement === "rented");
}
