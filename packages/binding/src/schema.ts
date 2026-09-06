/**
 * The place-set binding (architecture §3): TypeScript types and a zod mirror
 * of `schemas/place-set-binding-1.0.json`. The JSON Schema is the contract
 * (shared with the twin MCP); the zod mirror gives typed parsing in code.
 * Keep the three in step.
 */

import { z } from "zod";

export const PLACE_ID_PATTERN = /^[a-z_]+\/[a-z0-9-]+$/;
export const ENTITY_ID_PATTERN = /^entity\/[a-z0-9-]+$/;

export const ARCHETYPES = ["creek", "watershed", "reservoir", "mountain", "bioregion"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const MEMBER_ROLES = ["main_stem_gauge", "gauge", "snotel", "reservoir", "water_quality", "air", "weather", "other"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const AGGS = ["single", "mean", "median", "min", "max", "mean_24h", "max_intersecting"] as const;
export type Agg = (typeof AGGS)[number];

/** The five WQ properties rule 3 accepts for `water_quality`. */
export const WATER_QUALITY_PROPERTIES = ["water_temp", "dissolved_oxygen", "ph", "turbidity", "specific_conductance"] as const;
/** Rule 3 for `air`. */
export const AIR_PROPERTIES = ["pm25", "ozone"] as const;

export interface BindingMember {
  id: string;
  role: MemberRole;
  name?: string;
}

export interface BindingNeed {
  need: string;
  property: string;
  places: string[];
  agg: Agg;
  weight?: number;
}

export interface Binding {
  schema_version: "1.0";
  binding_version: number;
  entity_id: string;
  archetype: Archetype;
  anchor: string;
  stream_id: string | null;
  commons_handle: string;
  members: BindingMember[];
  watersheds: string[];
  reach_ids: string[];
  boundary: { geometry_urls: string[] };
  needs: BindingNeed[];
  membership_rule: string;
  frozen_at: string;
  reviewed_by: string | null;
  twin_index_etag: string | null;
}

const placeId = z.string().regex(PLACE_ID_PATTERN, "not a twin place id");

export const BindingMemberSchema = z.strictObject({
  id: placeId,
  role: z.enum(MEMBER_ROLES),
  name: z.string().optional(),
});

export const BindingNeedSchema = z.strictObject({
  need: z.string(),
  property: z.string(),
  places: z.array(placeId),
  agg: z.enum(AGGS),
  weight: z.number().min(0).max(1).optional(),
});

export const BindingSchema = z.strictObject({
  schema_version: z.literal("1.0"),
  binding_version: z.number().int().min(1),
  entity_id: z.string().regex(ENTITY_ID_PATTERN, "not an entity id"),
  archetype: z.enum(ARCHETYPES),
  anchor: placeId,
  stream_id: placeId.nullable(),
  commons_handle: z.string(),
  members: z.array(BindingMemberSchema),
  watersheds: z.array(placeId),
  reach_ids: z.array(z.string()),
  boundary: z.strictObject({ geometry_urls: z.array(z.string().url()) }),
  needs: z.array(BindingNeedSchema).min(1).max(8),
  membership_rule: z.string(),
  frozen_at: z.string(),
  reviewed_by: z.string().nullable(),
  twin_index_etag: z.string().nullable(),
});

export type BindingInput = z.input<typeof BindingSchema>;
