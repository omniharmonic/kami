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
import { BindingSchema, type BindingNeed } from "@kami/binding";

export const KAMI_ENTITY_CONFIG_PREFIX = "KAMI_ENTITY_CONFIG:";

export type EntityConfig = {
  entity: { id: string; slug: string; name: string; archetype: string };
  binding_version: number | null;
  anchor: string | null;
  members: number | null;
  binding_review: string;
  binding_active: boolean;
  binding_note: string;
  member_places: { id: string; name: string | null; role: string }[];
  member_places_truncated: boolean;
  membership_rule: string | null;
  need_mappings: BindingNeed[];
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
  /** Lifecycle/review eligibility, not a grant of authority or runtime capability. */
  agent_writes_allowed: boolean;
  agent_write_block_reason: "paused" | "retired" | "binding_pending_review" | "binding_unavailable" | null;
  agent_write_policy: string;
  disclosure: string;
};

function displayName(name: string | null, email: string): string {
  return name?.trim() || email.split("@")[0] || "someone";
}

export async function buildEntityConfig(db: DbOrTx, entity: EntityRow, binding: CurrentBinding | null): Promise<EntityConfig> {
  // Review gates computed needs, not read-only discovery of proposed sensors.
  // Never turn an unavailable approved binding into a claim of zero members.
  const [row] = entity.bindingVersion === null ? [] : await db.select().from(schema.entityBindings)
    .where(and(eq(schema.entityBindings.entityId, entity.id), eq(schema.entityBindings.bindingVersion, entity.bindingVersion))).limit(1);
  const parsed = row ? BindingSchema.safeParse(row.binding) : null;
  const proposed = binding?.binding ?? (parsed?.success ? parsed.data : null);
  const review = row ? (parsed?.success ? row.review : "invalid") : (binding ? "approved" : "missing");
  const bindingActive = binding !== null && review === "approved" && binding.version === entity.bindingVersion;
  const writeBlockReason: EntityConfig["agent_write_block_reason"] = entity.retiredAt !== null ? "retired"
    : entity.pausedAt !== null ? "paused" : bindingActive ? null
    : review === "pending_review" ? "binding_pending_review" : "binding_unavailable";
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
    anchor: proposed?.anchor ?? null,
    members: proposed?.members.length ?? null,
    binding_review: review,
    binding_active: bindingActive,
    binding_note: proposed
      ? "These are configured or proposed places, not a count of live sensors. Use member_places IDs with the public twin get_place tool to inspect readings, timestamps and source health. Binding review gates the computed needs snapshot; pending review does not mean sensors are absent."
      : "No valid binding is available. Sensor membership is unknown, not zero. Search the public twin with find_places to discover candidate monitoring sites.",
    member_places: proposed?.members.slice(0, 100).map(({ id, name, role }) => ({ id, name: name ?? null, role })) ?? [],
    member_places_truncated: (proposed?.members.length ?? 0) > 100,
    membership_rule: proposed?.membership_rule ?? null,
    need_mappings: proposed?.needs ?? [],
    watersheds: proposed?.watersheds ?? [],
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
    agent_writes_allowed: writeBlockReason === null,
    agent_write_block_reason: writeBlockReason,
    agent_write_policy: "This flag reports lifecycle and binding-review eligibility only. Paused or retired beings and unapproved bindings cannot publish agent updates or draft bounties. Authentication, tool permissions, evidence guards, caps and budgets still apply. Each runtime may impose read-only access; this flag does not grant website chat write tools.",
    disclosure: disclosureLabel(entity.name, entity.archetype),
  };
}

/** `KAMI_ENTITY_CONFIG: {...}` — one line, safe to place in a `role: system` message. */
export function entityConfigSystemMessage(config: EntityConfig): string {
  return `${KAMI_ENTITY_CONFIG_PREFIX} ${JSON.stringify(config)}`;
}
