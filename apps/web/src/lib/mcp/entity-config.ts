/**
 * The `KAMI_ENTITY_CONFIG` block (docs/verify.md #31): the platform-injected
 * facts the gate admits as atoms — caps, guardian names, the disclosure
 * label, the binding version. Returned by `get_entity_config` both as
 * structured JSON and as one system-message string, so a client can put it
 * verbatim into a `role: system` message.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { disclosureLabel } from "@/copy";
import { getConfig } from "@/lib/jobs/common";
import { capsFrom, DEFAULT_DRAFTS_PER_WEEK, type BountyCaps } from "./bounty-spec";
import type { CurrentBinding, EntityRow } from "@/lib/jobs/needs";

export const KAMI_ENTITY_CONFIG_PREFIX = "KAMI_ENTITY_CONFIG:";

export type EntityConfig = {
  entity: { id: string; slug: string; name: string; archetype: string };
  binding_version: number | null;
  anchor: string | null;
  members: number;
  watersheds: string[];
  caps: {
    bounty_cap_usdc: BountyCaps;
    bounty_drafts_per_week: number;
    pulse_max_words: number;
    reminder_every_turns: number;
    claim_limit_max: number;
  };
  guardians: string[];
  stewards: string[];
  evaluators: number;
  paused: boolean;
  disclosure: string;
};

function displayName(name: string | null, email: string): string {
  return name?.trim() || email.split("@")[0] || "someone";
}

export async function buildEntityConfig(db: DbOrTx, entity: EntityRow, binding: CurrentBinding | null): Promise<EntityConfig> {
  const roles = await db
    .select({ role: schema.entityRoles.role, name: schema.users.name, email: schema.users.email })
    .from(schema.entityRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.entityRoles.userId))
    .where(and(eq(schema.entityRoles.entityId, entity.id), isNotNull(schema.entityRoles.acceptedAt), isNull(schema.entityRoles.revokedAt)));
  const [caps, perWeek, reminder, pulseWords] = await Promise.all([
    getConfig(db, "bounty_cap_usdc"),
    getConfig<number>(db, "bounty_drafts_per_week"),
    getConfig<number>(db, "reminder_every_turns"),
    getConfig<number>(db, "pulse_max_words"),
  ]);
  return {
    entity: { id: entity.id, slug: entity.slug, name: entity.name, archetype: entity.archetype },
    binding_version: binding?.version ?? entity.bindingVersion,
    anchor: binding?.binding.anchor ?? null,
    members: binding?.binding.members.length ?? 0,
    watersheds: binding?.binding.watersheds ?? [],
    caps: {
      bounty_cap_usdc: capsFrom(caps),
      bounty_drafts_per_week: typeof perWeek === "number" ? perWeek : DEFAULT_DRAFTS_PER_WEEK,
      pulse_max_words: typeof pulseWords === "number" ? pulseWords : 80,
      reminder_every_turns: typeof reminder === "number" ? reminder : 12,
      claim_limit_max: 50,
    },
    guardians: roles.filter((r) => r.role === "guardian").map((r) => displayName(r.name, r.email)).sort(),
    stewards: roles.filter((r) => r.role === "steward").map((r) => displayName(r.name, r.email)).sort(),
    evaluators: roles.filter((r) => r.role === "evaluator").length,
    paused: entity.pausedAt !== null,
    disclosure: disclosureLabel(entity.name, entity.archetype),
  };
}

/** `KAMI_ENTITY_CONFIG: {...}` — one line, safe to place in a `role: system` message. */
export function entityConfigSystemMessage(config: EntityConfig): string {
  return `${KAMI_ENTITY_CONFIG_PREFIX} ${JSON.stringify(config)}`;
}
