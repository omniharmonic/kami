/**
 * The bounty spec, PRD §7.6, as zod. The entity fills it, the guard checks
 * its numbers, guardians approve it as a whole. Tier 1 must carry a
 * `prediction` naming place, property, direction and window (PRD §7.3).
 * `spec_sha256` is computed over canonical JSON (sorted keys) so field order
 * cannot change the hash.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@/db/events";

const placeId = z.string().regex(/^[a-z_]+\/[a-z0-9-]+$/, "not a twin id");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const evidenceSpecSchema = z
  .object({
    min_photos: z.number().int().min(0).optional(),
    exif_required: z.boolean().optional(),
    gps_within_m: z.number().min(0).optional(),
    capture: z.enum(["in_app", "any"]).optional(),
    second_attestation_above_usdc: z.number().min(0).optional(),
    notes: z.string().max(500).optional(),
  })
  .catchall(z.union([z.string().max(200), z.number(), z.boolean()]));

export const predictionSchema = z.object({
  place_id: placeId,
  property: z.string().min(1).max(64),
  direction: z.enum(["up", "down", "flat"]),
  /** e.g. "14d", "2026-10-01/2026-10-31", "by 2026-11-01" — free but short */
  window: z.string().min(1).max(80),
  /** optional magnitude the entity commits to */
  magnitude: z.string().max(80).optional(),
});

export const bountySpecSchema = z
  .object({
    entity_id: z.string().regex(/^entity\/[a-z0-9-]+$/).optional(),
    title: z.string().min(3).max(200),
    why: z.string().min(1).max(2000),
    deliverable: z.string().min(1).max(2000),
    verification_tier: z.number().int().min(1).max(4),
    evidence_spec: evidenceSpecSchema.default({}),
    cap_usdc: z.number().positive(),
    claim_limit: z.number().int().min(1).max(50).default(1),
    deadline: isoDate.nullable().default(null),
    evaluator_hat: z.string().max(120).nullable().default(null),
    linked_strategy: z.string().max(200).nullable().default(null),
    twin_refs: z.array(placeId).min(1).max(20),
    prediction: predictionSchema.nullable().default(null),
  })
  .superRefine((spec, ctx) => {
    if (spec.verification_tier === 1 && !spec.prediction) {
      ctx.addIssue({ code: "custom", path: ["prediction"], message: "a tier-1 bounty must carry a prediction (place, property, direction, window)" });
    }
  });

export type BountySpec = z.infer<typeof bountySpecSchema>;
export type BountySpecInput = z.input<typeof bountySpecSchema>;

/** sha256 over the canonical (key-sorted) JSON of the spec as stored. */
export function specSha256(spec: BountySpec): string {
  return createHash("sha256").update(canonicalJson(spec), "utf8").digest("hex");
}

export type BountyCaps = { min: number; max: number };
export const DEFAULT_BOUNTY_CAPS: BountyCaps = { min: 25, max: 150 };
export const DEFAULT_DRAFTS_PER_WEEK = 3;

export function capsFrom(value: unknown): BountyCaps {
  const v = value as Partial<BountyCaps> | undefined;
  const min = typeof v?.min === "number" && v.min > 0 ? v.min : DEFAULT_BOUNTY_CAPS.min;
  const max = typeof v?.max === "number" && v.max >= min ? v.max : Math.max(min, DEFAULT_BOUNTY_CAPS.max);
  return { min, max };
}

/** ISO-8601 week (Monday start) as `YYYY-Www`, in UTC. */
export function isoWeekOf(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** [Monday 00:00Z, next Monday 00:00Z) of the ISO week containing `d`. */
export function isoWeekBounds(d: Date): { start: Date; end: Date } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - (day - 1));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}
