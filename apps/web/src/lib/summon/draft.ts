/**
 * The summon state machine over `summon_drafts` (PRD §6.2, architecture
 * Appendix A.1, plan T3.1).
 *
 * Five steps, then a review. Two properties hold at every step:
 *
 * - **resumable** — the draft row is the whole state. `step` is a hint;
 *   `resumeStep()` derives the truth from the data, so a closed tab, a dead
 *   battery or a second device all land on the same place.
 * - **idempotent** — `saveStep` overwrites its own slice of `data` and never
 *   moves the pointer backwards; `completeSummon` is a no-op after the first
 *   success (it returns the entity it already created).
 *
 * Nothing here publishes. An entity created by `completeSummon` exists, has a
 * binding in `pending_review`, a soul, a steward and two invited guardians —
 * and its page stays private until a steward explicitly publishes it.
 * Consultation is encouraged and can be recorded independently.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { bindingSha256, type Binding } from "@kami/binding";
import { getDb, type Db } from "@/db/client";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { inviteGuardian, requireEntityRole, type SendInviteMail } from "@/lib/governance/roles";
import { withTx } from "@/lib/governance/tx";
import type { SensingRow } from "./sensing";
import type { RiveConfig } from "./parts";
import { defaultRiveConfig, normalizeRiveConfig } from "./parts";
import { validateVoice, VoiceBlockError, loadHardRules } from "./soul";

export const FIRST_STEP = 1;
export const LAST_STEP = 5;
export const REVIEW_STEP = 6;
export const DONE_STEP = 7;

export type SummonErrorCode =
  | "unauthenticated"
  | "no_db"
  | "draft_not_found"
  | "step_incomplete"
  | "already_completed"
  | "slug_taken"
  | "binding_invalid"
  | "voice_invalid"
  | "hard_rules_immutable"
  | "guardians_invalid"
  | "invalid_step";

export class SummonError extends Error {
  override name = "SummonError";
  constructor(
    public readonly code: SummonErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function isSummonError(e: unknown): e is SummonError {
  return e instanceof SummonError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "SummonError");
}

// ---------------------------------------------------------------------------
// draft data
// ---------------------------------------------------------------------------

export type PlaceChoice = {
  /** the twin place the creator picked in the search */
  picked_id: string;
  picked_name: string;
  picked_kind: string;
  /** the search phrase the proposal was built from */
  query: string;
  gnis_id: string | null;
  archetype: string;
  name: string;
  slug: string;
  binding: Binding;
  binding_sha256: string;
  provenance: string;
  notes: string[];
  stats: Record<string, number>;
  sensing: SensingRow[];
  gaps: string[];
  twin_base_url: string;
  ids_schema_from: "twin" | "pinned";
  validation: { ok: boolean; errors: Array<{ path: string; message: string }>; warnings: Array<{ path: string; message: string }> };
  /** siblings shown before step 2, so plurality is seen before any effort (§4.4) */
  siblings_seen: number;
};

export type PartsChoice = { rive_config: RiveConfig };
export type SoulChoice = { voice_md: string; hard_rules_version: number };
export type GuardiansChoice = { emails: [string, string] | string[] };
export type FundChoice = { skipped: boolean; note: string | null };
export type ConsultationChoice = { md: string };
export type CompletedRecord = {
  entity_id: string;
  slug: string;
  at: string;
  published: boolean;
  invites: string[];
};

export type DraftData = {
  place?: PlaceChoice;
  parts?: PartsChoice;
  soul?: SoulChoice;
  guardians?: GuardiansChoice;
  fund?: FundChoice;
  consultation?: ConsultationChoice;
  completed?: CompletedRecord;
};

export type Draft = {
  id: string;
  user_id: string;
  /** the step to resume at: 1–5, 6 = review, 7 = done */
  step: number;
  data: DraftData;
  updated_at: string | null;
};

const STEP_KEYS: Record<number, keyof DraftData> = { 1: "place", 2: "parts", 3: "soul", 4: "guardians", 5: "fund" };

/** The first step whose slice is missing — the truth about where to resume. */
export function resumeStep(data: DraftData): number {
  if (data.completed) return DONE_STEP;
  for (const step of [1, 2, 3, 4, 5]) {
    if (data[STEP_KEYS[step]!] === undefined) return step;
  }
  return REVIEW_STEP;
}

export function stepIsComplete(data: DraftData, step: number): boolean {
  const key = STEP_KEYS[step];
  return key ? data[key] !== undefined : false;
}

type Deps = { db?: DbOrTx | null; now?: Date };

function dbOf(deps: Deps): DbOrTx {
  const db = deps.db === undefined ? (getDb() as Db | null) : deps.db;
  if (!db) throw new SummonError("no_db", "no database is configured");
  return db;
}

function draftId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return `smn_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function rowToDraft(row: typeof schema.summonDrafts.$inferSelect): Draft {
  const data = (row.data ?? {}) as DraftData;
  return {
    id: row.id,
    user_id: row.userId ?? "",
    step: Math.max(row.step ?? FIRST_STEP, resumeStep(data)),
    data,
    updated_at: row.updatedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createDraft(userId: string, deps: Deps = {}): Promise<Draft> {
  if (!userId) throw new SummonError("unauthenticated");
  const db = dbOf(deps);
  const now = deps.now ?? new Date();
  const id = draftId();
  const [row] = await db.insert(schema.summonDrafts).values({ id, userId, step: FIRST_STEP, data: {}, updatedAt: now }).returning();
  return rowToDraft(row!);
}

/** A draft belongs to exactly one user; another user's id is `draft_not_found`, not `forbidden`. */
export async function loadDraft(id: string, userId: string, deps: Deps = {}): Promise<Draft> {
  const db = dbOf(deps);
  const [row] = await db.select().from(schema.summonDrafts).where(eq(schema.summonDrafts.id, id)).limit(1);
  if (!row || row.userId !== userId) throw new SummonError("draft_not_found");
  return rowToDraft(row);
}

export async function listDrafts(userId: string, deps: Deps = {}): Promise<Draft[]> {
  const db = dbOf(deps);
  const rows = await db
    .select()
    .from(schema.summonDrafts)
    .where(eq(schema.summonDrafts.userId, userId))
    .orderBy(desc(schema.summonDrafts.updatedAt));
  return rows.map(rowToDraft);
}

/**
 * Merge `patch` into the draft's data and move the pointer to the next step.
 * Re-saving an earlier step keeps the later data and never rewinds the
 * pointer, so "go back and change the hat" costs nothing.
 */
export async function saveStep(id: string, step: number, patch: Partial<DraftData>, deps: Deps = {}): Promise<Draft> {
  if (!Number.isInteger(step) || step < FIRST_STEP || step > REVIEW_STEP) throw new SummonError("invalid_step", `step ${step}`);
  const db = dbOf(deps);
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const [row] = await tx.select().from(schema.summonDrafts).where(eq(schema.summonDrafts.id, id)).limit(1);
    if (!row) throw new SummonError("draft_not_found");
    const current = (row.data ?? {}) as DraftData;
    if (current.completed) throw new SummonError("already_completed");
    if ("soul" in patch && patch.soul) validateVoice(patch.soul.voice_md);
    const data: DraftData = { ...current, ...patch };
    const pointer = Math.max(row.step ?? FIRST_STEP, Math.min(step + 1, REVIEW_STEP), resumeStep(data));
    const [saved] = await tx
      .update(schema.summonDrafts)
      .set({ data, step: pointer, updatedAt: now })
      .where(eq(schema.summonDrafts.id, id))
      .returning();
    return rowToDraft(saved!);
  });
}

export async function deleteDraft(id: string, userId: string, deps: Deps = {}): Promise<void> {
  const db = dbOf(deps);
  const draft = await loadDraft(id, userId, { ...deps, db });
  if (draft.data.completed) throw new SummonError("already_completed");
  await db.delete(schema.summonDrafts).where(eq(schema.summonDrafts.id, id));
}

// ---------------------------------------------------------------------------
// completion
// ---------------------------------------------------------------------------

export type CompleteResult = {
  entity_id: string;
  slug: string;
  name: string;
  binding_version: number;
  binding_review: "pending_review";
  soul_version: number;
  invites: Array<{ id: string; email: string }>;
  /** False until a steward explicitly publishes the being. */
  published: boolean;
  publish_blocked_by: "unpublished" | null;
  safe: { state: string; reason: string };
  already: boolean;
};

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeGuardianEmails(emails: string[], creatorEmail: string): [string, string] {
  const cleaned = emails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0);
  if (cleaned.length !== 2) throw new SummonError("guardians_invalid", "two guardian addresses are needed");
  for (const e of cleaned) {
    if (!EMAIL_RE.test(e)) throw new SummonError("guardians_invalid", `${e} does not look like an email address`);
    if (e === creatorEmail.trim().toLowerCase()) throw new SummonError("guardians_invalid", "a guardian must be someone other than you");
  }
  if (cleaned[0] === cleaned[1]) throw new SummonError("guardians_invalid", "those two addresses are the same");
  return [cleaned[0]!, cleaned[1]!];
}

export type CompleteDeps = Deps & {
  sendMail?: SendInviteMail;
  baseUrl?: string;
  /** injected in tests; production leaves it unset and the Safe is recorded pending */
  deploySafe?: import("./safe").DeploySafeFn | null;
};

/**
 * Create everything and publish nothing.
 *
 * entity + rive_config + consultation_md, binding v1 (`pending_review`), soul
 * v1 (hard rules from the template, voice from the draft), the creator as
 * steward, two guardian invites. `published` is false while
 * `entities.published_at` is null until an explicit human publication action.
 */
export async function completeSummon(id: string, deps: CompleteDeps = {}): Promise<CompleteResult> {
  const db = dbOf(deps);
  const now = deps.now ?? new Date();
  const [row] = await db.select().from(schema.summonDrafts).where(eq(schema.summonDrafts.id, id)).limit(1);
  if (!row) throw new SummonError("draft_not_found");
  const data = (row.data ?? {}) as DraftData;
  const userId = row.userId;
  if (!userId) throw new SummonError("unauthenticated");

  // Idempotent: a second call returns the first call's entity untouched.
  if (data.completed) {
    const summary = await describeCompleted(db, data.completed);
    return { ...summary, already: true };
  }

  for (const step of [1, 2, 3, 4]) {
    if (!stepIsComplete(data, step)) throw new SummonError("step_incomplete", `step ${step} is not finished`);
  }
  const place = data.place!;
  const soul = data.soul!;
  const guardians = data.guardians!;
  // Cheapest and most specific refusal first: an address already taken.
  const [taken] = await db.select({ id: schema.entities.id }).from(schema.entities).where(eq(schema.entities.slug, place.slug)).limit(1);
  if (taken) throw new SummonError("slug_taken", `a kami already lives at /e/${place.slug}`);
  if (!place.validation.ok) {
    throw new SummonError(
      "binding_invalid",
      `the proposed binding does not validate against the twin: ${place.validation.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`,
    );
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new SummonError("unauthenticated");
  const emails = normalizeGuardianEmails(guardians.emails, user.email);

  let voice: string;
  try {
    voice = validateVoice(soul.voice_md);
  } catch (err) {
    if (err instanceof VoiceBlockError) throw new SummonError("voice_invalid", err.message);
    throw err;
  }
  // The hard rules are read from the template on the server, every time. The
  // draft's `hard_rules_version` is a record, never an input.
  const hardRules = await loadHardRules();

  const slug = place.slug;
  const entityId = `entity/${slug}`;
  const binding: Binding = { ...place.binding, entity_id: entityId, binding_version: 1, frozen_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"), reviewed_by: null };
  const sha256 = bindingSha256(binding);
  const riveConfig = data.parts?.rive_config ?? defaultRiveConfig(place.archetype);

  const created = await withTx(db, async (tx) => {
    const [clash] = await tx.select({ id: schema.entities.id }).from(schema.entities).where(eq(schema.entities.slug, slug)).limit(1);
    if (clash) throw new SummonError("slug_taken", `a kami already lives at /e/${slug}`);

    await tx.insert(schema.entities).values({
      id: entityId,
      slug,
      name: place.name,
      archetype: riveConfig.archetype,
      bindingVersion: 1,
      soulVersion: 1,
      hermesProfile: slug,
      riveConfig: normalizeRiveConfig(riveConfig, riveConfig.archetype) as unknown as object,
      cosmetics: {},
      consultationMd: data.consultation?.md ?? null,
      consultationDoneAt: null,
      createdBy: userId,
    });
    await tx.insert(schema.entityBindings).values({
      entityId,
      bindingVersion: 1,
      binding: binding as unknown as object,
      sha256,
      review: "pending_review",
      reviewedBy: null,
      reviewedAt: null,
    });
    await tx.insert(schema.souls).values({ entityId, soulVersion: 1, hardRulesVersion: String(hardRules.version), voiceMd: voice, editedBy: userId });
    // The creator is the steward from the first second: `inviteGuardian`
    // requires a role, and someone must answer for this kami in public.
    await tx
      .insert(schema.entityRoles)
      .values({ entityId, userId, role: "steward", invitedAt: now, acceptedAt: now })
      .onConflictDoNothing();

    await appendEntityEvent(tx, {
      entity_id: entityId,
      actor: userId,
      kind: "summoned",
      payload: {
        draft_id: id,
        slug,
        anchor: binding.anchor,
        binding_sha256: sha256,
        binding_review: "pending_review",
        hard_rules_version: hardRules.version,
        twin_base_url: place.twin_base_url,
        published: false,
        publish_blocked_by: "unpublished",
      },
      at: now,
    });
    return { entityId, slug };
  });

  // Invites are sent outside the entity transaction: a mail provider hiccup
  // must not roll back a kami that already exists.
  const invites: Array<{ id: string; email: string }> = [];
  for (const email of emails) {
    const inv = await inviteGuardian(
      db,
      { entity_id: created.entityId, email, invited_by: userId, ...(deps.baseUrl ? { base_url: deps.baseUrl } : {}) },
      { ...(deps.sendMail ? { sendMail: deps.sendMail } : {}), now },
    );
    invites.push({ id: inv.id, email });
  }

  const completed: CompletedRecord = {
    entity_id: created.entityId,
    slug: created.slug,
    at: now.toISOString(),
    published: false,
    invites: invites.map((i) => i.id),
  };
  await db.update(schema.summonDrafts).set({ data: { ...data, completed }, step: DONE_STEP, updatedAt: now }).where(eq(schema.summonDrafts.id, id));

  const { triggerSafeDeployment } = await import("./safe");
  const safe = await triggerSafeDeployment(db, created.entityId, { ...(deps.deploySafe ? { deploy: deps.deploySafe } : {}), now, actor: userId });

  return {
    entity_id: created.entityId,
    slug: created.slug,
    name: place.name,
    binding_version: 1,
    binding_review: "pending_review",
    soul_version: 1,
    invites,
    published: false,
    publish_blocked_by: "unpublished",
    safe: { state: safe.state, reason: safe.reason },
    already: false,
  };
}

async function describeCompleted(db: DbOrTx, completed: CompletedRecord): Promise<Omit<CompleteResult, "already">> {
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, completed.entity_id)).limit(1);
  const [binding] = await db
    .select()
    .from(schema.entityBindings)
    .where(eq(schema.entityBindings.entityId, completed.entity_id))
    .orderBy(desc(schema.entityBindings.bindingVersion))
    .limit(1);
  const invites = await db
    .select({ id: schema.guardianInvites.id, email: schema.guardianInvites.email })
    .from(schema.guardianInvites)
    .where(eq(schema.guardianInvites.entityId, completed.entity_id));
  const published = Boolean(entity?.publishedAt);
  const { safeReadiness } = await import("./safe");
  const safe = entity ? await safeReadiness(db, entity.id) : { state: "not_ready", reason: "no entity" };
  return {
    entity_id: completed.entity_id,
    slug: completed.slug,
    name: entity?.name ?? completed.slug,
    binding_version: binding?.bindingVersion ?? 1,
    binding_review: "pending_review",
    soul_version: entity?.soulVersion ?? 1,
    invites: invites.map((i) => ({ id: i.id, email: i.email ?? "" })),
    published,
    publish_blocked_by: published ? null : "unpublished",
    safe: { state: safe.state, reason: safe.reason },
  };
}

// ---------------------------------------------------------------------------
// explicit publication and optional consultation
// ---------------------------------------------------------------------------

export type PublishState = { published: boolean; published_at: string | null; blocked_by: "unpublished" | null; consultation_md: string | null; consultation_done_at: string | null };

export async function publishState(db: DbOrTx, entityId: string): Promise<PublishState> {
  const [e] = await db
    .select({ md: schema.entities.consultationMd, doneAt: schema.entities.consultationDoneAt, publishedAt: schema.entities.publishedAt })
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId))
    .limit(1);
  const done = e?.doneAt ?? null;
  return {
    published: e?.publishedAt != null,
    published_at: e?.publishedAt?.toISOString() ?? null,
    blocked_by: e?.publishedAt == null ? "unpublished" : null,
    consultation_md: e?.md ?? null,
    consultation_done_at: done?.toISOString() ?? null,
  };
}

/** The creator's record of who was consulted. Free prose; never a checkbox. */
export async function setConsultationNote(db: DbOrTx, entityId: string, md: string, actor: string, now = new Date()): Promise<void> {
  await db.update(schema.entities).set({ consultationMd: md }).where(eq(schema.entities.id, entityId));
  await appendEntityEvent(db, { entity_id: entityId, actor, kind: "consultation_recorded", payload: { chars: md.length }, at: now });
}

/** Explicit human publication, independent of consultation, pause and treasury. */
export async function publishEntity(db: DbOrTx, entityId: string, actor: string, now = new Date()): Promise<PublishState> {
  return withTx(db, async tx => {
    await requireEntityRole(tx, actor, entityId, ["steward"]);
    const [entity] = await tx.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1).for("update");
    if (!entity) throw new SummonError("draft_not_found", `no entity ${entityId}`);
    if (entity.retiredAt) throw new SummonError("step_incomplete", "A retired being cannot be published.");
    if (!entity.publishedAt) {
      await tx.update(schema.entities).set({ publishedAt: now }).where(eq(schema.entities.id, entityId));
      await appendEntityEvent(tx, { entity_id: entityId, actor, kind: "entity.published", payload: { published_at: now.toISOString(), consultation_recorded: Boolean(entity.consultationMd) }, at: now });
    }
    return publishState(tx, entityId);
  });
}

/** Optional consultation record. This never publishes or unpauses a being. */
export async function markConsultationDone(db: DbOrTx, entityId: string, actor: string, now = new Date()): Promise<PublishState> {
  const [e] = await db.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
  if (!e) throw new SummonError("draft_not_found", `no entity ${entityId}`);
  if (e.consultationDoneAt) return publishState(db, entityId);
  await db.update(schema.entities).set({ consultationDoneAt: now }).where(eq(schema.entities.id, entityId));
  await appendEntityEvent(db, {
    entity_id: entityId,
    actor,
    kind: "consultation_marked_done",
    payload: { consultation_done_at: now.toISOString(), has_record: Boolean(e.consultationMd) },
    at: now,
  });
  return publishState(db, entityId);
}

/** Entities not explicitly published by a human steward. */
export async function unpublishedEntities(db: DbOrTx) {
  return db
    .select({ id: schema.entities.id, slug: schema.entities.slug, name: schema.entities.name, consultationMd: schema.entities.consultationMd })
    .from(schema.entities)
    .where(and(isNull(schema.entities.publishedAt), isNull(schema.entities.retiredAt)))
    .orderBy(schema.entities.slug);
}
