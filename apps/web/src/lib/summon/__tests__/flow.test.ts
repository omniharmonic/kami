/**
 * One scripted summon, end to end and timed (PRD G3: a stranger, an email
 * address, under twenty minutes). What is measured here is the *server-side*
 * work of all five steps — the twin reads, the proposal, the validation, the
 * soul render, the writes — against a local fixture tree. The rest of the
 * twenty minutes is a person reading and typing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listEntityEvents } from "@/db/events";
import {
  bindTwinTo,
  closeTestDb,
  createTestDb,
  frontRangeTreeRepaired,
  frontRangeTwin,
  seedUser,
  twinFromDir,
  type TestDb,
} from "./helpers";
import {
  completeSummon,
  createDraft,
  loadDraft,
  markConsultationDone,
  publishState,
  resumeStep,
  saveStep,
  SummonError,
  DONE_STEP,
  REVIEW_STEP,
} from "../draft";
import { normalizeRiveConfig } from "../parts";
import { searchPlaces } from "../places";
import { proposeForPlace } from "../propose";
import { siblingsForAnchor } from "../siblings";
import { validateVoice } from "../soul";

const VOICE =
  "You speak for Boulder Creek from the canyon mouth at Orodell down through town, in a plain Front Range voice. You call things by their local names. You never claim to be the creek, only an AI voice for it.";

let db: TestDb;
const mails: Array<{ email: string; url: string; entityName: string }> = [];
const sendMail = async (m: { email: string; url: string; entityName: string }) => {
  mails.push(m);
};

beforeAll(async () => {
  db = await createTestDb();
  await seedUser(db, "u-maya", "maya@example.org");
  await seedUser(db, "u-other", "other@example.org");
});
afterAll(async () => {
  await closeTestDb(db);
});

/** An entity already bound to the anchor, so step 1 has siblings to show. */
async function seedSibling(anchor: string) {
  await db.insert(schema.entities).values({
    id: "entity/boulder-creek-school",
    slug: "boulder-creek-school",
    name: "Boulder Creek (Casey Middle School)",
    archetype: "creek",
    bindingVersion: 1,
    hermesProfile: "boulder-creek-school",
    createdBy: "u-other",
  });
  await db.insert(schema.entityBindings).values({
    entityId: "entity/boulder-creek-school",
    bindingVersion: 1,
    binding: { anchor, entity_id: "entity/boulder-creek-school" } as unknown as object,
    sha256: "0".repeat(64),
    review: "approved",
  });
  await db.insert(schema.entityRoles).values({ entityId: "entity/boulder-creek-school", userId: "u-other", role: "steward", acceptedAt: new Date() });
}

describe("a scripted summon, timed against the G3 budget", () => {
  it("completes every server-side step and creates entity + binding + soul + two invites", async () => {
    const tree = twinFromDir(frontRangeTreeRepaired());
    const started = Date.now();

    // --- step 1: place -----------------------------------------------------
    const found = await searchPlaces(tree, { query: "boulder creek", limit: 25 });
    expect(found.total).toBeGreaterThan(0);
    const picked = found.places.find((p) => p.id === "place/boulder-creek-near-orodell-co")!;
    expect(picked).toBeTruthy();

    const proposal = await proposeForPlace(tree, { place_id: picked.id, slug: "boulder-creek", name: "Boulder Creek" }, { db });
    expect(proposal.place.provenance).toMatch(/platform guess/);
    expect(proposal.place.binding.anchor).toBe("place/boulder-creek-near-orodell-co");
    expect(proposal.place.sensing.some((r) => r.need === "flow")).toBe(true);
    // the honest gap is named, not papered over
    expect(proposal.place.gaps.join(" ")).toMatch(/no percentile is published for flow yet/);

    const draft = await createDraft("u-maya", { db });
    expect(draft.step).toBe(1);
    await saveStep(draft.id, 1, { place: proposal.place }, { db });

    // --- step 2: archetype and parts --------------------------------------
    const rive = normalizeRiveConfig({ archetype: "creek", parts: { hat: "field", eyes: "wide" }, colour: "moss" }, "creek");
    expect(rive.parts.hat).toBe("field");
    await saveStep(draft.id, 2, { parts: { rive_config: rive } }, { db });

    // --- step 3: soul ------------------------------------------------------
    await saveStep(draft.id, 3, { soul: { voice_md: validateVoice(VOICE), hard_rules_version: 1 } }, { db });

    // --- step 4: guardians -------------------------------------------------
    await saveStep(draft.id, 4, { guardians: { emails: ["ana@example.org", "ben@example.org"] } }, { db });

    // --- step 5: fund (skipped) + the consultation record ------------------
    await saveStep(draft.id, 5, { fund: { skipped: true, note: null } }, { db });
    await saveStep(draft.id, REVIEW_STEP, { consultation: { md: "Letter sent to the three Tribal offices on 2026-09-01; awaiting a reply." } }, { db });

    const result = await completeSummon(draft.id, { db, sendMail, baseUrl: "https://kami.test" });
    const elapsedMs = Date.now() - started;

    expect(result.entity_id).toBe("entity/boulder-creek");
    expect(result.binding_review).toBe("pending_review");
    expect(result.published).toBe(false);
    expect(result.invites).toHaveLength(2);

    const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, "entity/boulder-creek"));
    expect(entity!.archetype).toBe("creek");
    expect(entity!.consultationMd).toMatch(/Tribal offices/);
    expect(entity!.consultationDoneAt).toBeNull();
    expect((entity!.riveConfig as { parts?: Record<string, string> }).parts?.hat).toBe("field");

    const [bindingRow] = await db.select().from(schema.entityBindings).where(eq(schema.entityBindings.entityId, "entity/boulder-creek"));
    expect(bindingRow!.review).toBe("pending_review");
    expect(bindingRow!.reviewedBy).toBeNull();
    expect(bindingRow!.sha256).toMatch(/^[0-9a-f]{64}$/);

    const [soulRow] = await db.select().from(schema.souls).where(eq(schema.souls.entityId, "entity/boulder-creek"));
    expect(soulRow!.hardRulesVersion).toBe("1");
    expect(soulRow!.voiceMd).toBe(VOICE);
    // the hard rules are NOT stored in the soul row: they are rendered from the template
    expect(soulRow!.voiceMd).not.toContain("kami:hard-rules");

    const invites = await db.select().from(schema.guardianInvites).where(eq(schema.guardianInvites.entityId, "entity/boulder-creek"));
    expect(invites.map((i) => i.email).sort()).toEqual(["ana@example.org", "ben@example.org"]);
    expect(mails).toHaveLength(2);
    expect(mails[0]!.url).toMatch(/^https:\/\/kami\.test\/guardian\/accept\?token=/);

    const [steward] = await db
      .select()
      .from(schema.entityRoles)
      .where(and(eq(schema.entityRoles.entityId, "entity/boulder-creek"), eq(schema.entityRoles.role, "steward")));
    expect(steward!.userId).toBe("u-maya");
    expect(steward!.acceptedAt).not.toBeNull();

    const events = await listEntityEvents(db, "entity/boulder-creek");
    expect(events.map((e) => e.kind)).toContain("summoned");

    // G3 is twenty minutes of a person's time. The server's share of it:
    const budgetMs = 20 * 60_000;
    // eslint-disable-next-line no-console
    console.log(`[G3] server-side work of all five summon steps: ${elapsedMs} ms (budget ${budgetMs} ms = 20 min; ${((elapsedMs / budgetMs) * 100).toFixed(2)} % of it)`);
    expect(elapsedMs).toBeLessThan(budgetMs / 20); // well within: under one minute
  }, 120_000);

  it("is idempotent: completing twice returns the same entity and creates nothing new", async () => {
    const drafts = await db.select().from(schema.summonDrafts);
    const done = drafts.find((d) => (d.data as { completed?: unknown }).completed)!;
    const again = await completeSummon(done.id, { db, sendMail });
    expect(again.already).toBe(true);
    expect(again.entity_id).toBe("entity/boulder-creek");
    const invites = await db.select().from(schema.guardianInvites).where(eq(schema.guardianInvites.entityId, "entity/boulder-creek"));
    expect(invites).toHaveLength(2);
  });
});

describe("resuming", () => {
  it("picks up at the right step with no data loss", async () => {
    const draft = await createDraft("u-maya", { db });
    const tree = frontRangeTwin();
    const proposal = await proposeForPlace(tree, { place_id: "place/boulder-creek-co-below-broadway-st", slug: "boulder-creek-2", name: "Boulder Creek Below Broadway" }, { db });
    await saveStep(draft.id, 1, { place: proposal.place }, { db });
    await saveStep(draft.id, 2, { parts: { rive_config: normalizeRiveConfig({ colour: "sandstone" }, "creek") } }, { db });

    // "the tab closed here"
    const resumed = await loadDraft(draft.id, "u-maya", { db });
    expect(resumed.step).toBe(3);
    expect(resumeStep(resumed.data)).toBe(3);
    expect(resumed.data.place!.binding.anchor).toBe(proposal.place.binding.anchor);
    expect(resumed.data.place!.sensing.length).toBe(proposal.place.sensing.length);
    expect(resumed.data.parts!.rive_config.colour).toBe("sandstone");

    // going back to step 2 keeps step 1 and does not rewind the pointer
    await saveStep(draft.id, 2, { parts: { rive_config: normalizeRiveConfig({ colour: "granite" }, "creek") } }, { db });
    const again = await loadDraft(draft.id, "u-maya", { db });
    expect(again.step).toBe(3);
    expect(again.data.parts!.rive_config.colour).toBe("granite");
    expect(again.data.place).toBeDefined();

    // and it is nobody else's draft
    await expect(loadDraft(draft.id, "u-other", { db })).rejects.toMatchObject({ code: "draft_not_found" });
  }, 60_000);

  it("refuses a voice block that a step-3 save tries to smuggle past validation", async () => {
    const draft = await createDraft("u-maya", { db });
    await expect(saveStep(draft.id, 3, { soul: { voice_md: "One. Two. Three. Four.", hard_rules_version: 1 } }, { db })).rejects.toThrow(/limit is 3/);
    await expect(saveStep(draft.id, 3, { soul: { voice_md: "  ", hard_rules_version: 1 } }, { db })).rejects.toThrow(/empty/);
    await expect(saveStep(draft.id, 3, { soul: { voice_md: "See <!-- kami:hard-rules v1 start -->.", hard_rules_version: 1 } }, { db })).rejects.toThrow(/fence marker/);
  });
});

describe("siblings are shown before any effort is invested (§4.4)", () => {
  it("returns siblings for the anchor at step 1, with their steward", async () => {
    const anchor = "place/boulder-creek-near-orodell-co";
    await seedSibling(anchor);
    const tree = frontRangeTwin();
    const proposal = await proposeForPlace(tree, { place_id: anchor, slug: "boulder-creek-3", name: "Boulder Creek Three" }, { db });
    expect(proposal.place.binding.anchor).toBe(anchor);
    expect(proposal.siblings.length).toBeGreaterThanOrEqual(1);
    const school = proposal.siblings.find((s) => s.slug === "boulder-creek-school")!;
    expect(school.steward?.name).toBe("u-other");
    expect(school.href).toBe("/e/boulder-creek-school");
    expect(proposal.place.siblings_seen).toBe(proposal.siblings.length);

    // and the same query from the entity side excludes the entity itself
    const list = await siblingsForAnchor(anchor, "entity/boulder-creek-school", db);
    expect(list.map((s) => s.slug)).not.toContain("boulder-creek-school");
  }, 60_000);
});

describe("the consultation gate (PRD §13 #4)", () => {
  it("creates everything and refuses to publish until a steward marks it done", async () => {
    const state = await publishState(db, "entity/boulder-creek");
    expect(state.published).toBe(false);
    expect(state.blocked_by).toBe("consultation");
    expect(state.consultation_md).toMatch(/Tribal offices/);

    // the entity, its binding and its soul all exist while unpublished
    const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, "entity/boulder-creek"));
    expect(entity).toBeTruthy();

    const after = await markConsultationDone(db, "entity/boulder-creek", "u-maya", new Date("2026-09-07T00:00:00Z"));
    expect(after.published).toBe(true);
    expect(after.consultation_done_at).toBe("2026-09-07T00:00:00.000Z");

    // idempotent
    const again = await markConsultationDone(db, "entity/boulder-creek", "u-maya", new Date("2026-09-08T00:00:00Z"));
    expect(again.consultation_done_at).toBe("2026-09-07T00:00:00.000Z");

    const events = await listEntityEvents(db, "entity/boulder-creek");
    expect(events.map((e) => e.kind)).toContain("consultation_marked_done");
  });
});

describe("refusals", () => {
  it("will not complete a draft whose earlier steps are unfinished", async () => {
    const draft = await createDraft("u-maya", { db });
    await expect(completeSummon(draft.id, { db, sendMail })).rejects.toBeInstanceOf(SummonError);
    await expect(completeSummon(draft.id, { db, sendMail })).rejects.toMatchObject({ code: "step_incomplete" });
  });

  it("will not take a slug another kami already lives at", async () => {
    const tree = twinFromDir(frontRangeTreeRepaired());
    const draft = await createDraft("u-maya", { db });
    const proposal = await proposeForPlace(tree, { place_id: "place/boulder-creek-near-orodell-co", slug: "boulder-creek", name: "Boulder Creek" }, { db });
    await saveStep(draft.id, 1, { place: proposal.place }, { db });
    await saveStep(draft.id, 2, { parts: { rive_config: normalizeRiveConfig({}, "creek") } }, { db });
    await saveStep(draft.id, 3, { soul: { voice_md: VOICE, hard_rules_version: 1 } }, { db });
    await saveStep(draft.id, 4, { guardians: { emails: ["ana@example.org", "ben@example.org"] } }, { db });
    await saveStep(draft.id, 5, { fund: { skipped: true, note: null } }, { db });
    await expect(completeSummon(draft.id, { db, sendMail })).rejects.toMatchObject({ code: "slug_taken" });
  }, 60_000);

  it("refuses to create anything from a binding the twin's own schema rejects", async () => {
    // The shipped fixture plants `elevation_m` on one id record; rule 2 says
    // so, and a kami is not created on a body the twin does not recognise.
    const tree = frontRangeTwin();
    const draft = await createDraft("u-maya", { db });
    const proposal = await proposeForPlace(tree, { place_id: "place/boulder-creek-near-orodell-co", slug: "boulder-creek-bad", name: "Boulder Creek Bad" }, { db });
    expect(proposal.place.validation.ok).toBe(false);
    expect(proposal.place.validation.errors[0]!.message).toMatch(/elevation_m/);
    await saveStep(draft.id, 1, { place: proposal.place }, { db });
    await saveStep(draft.id, 2, { parts: { rive_config: normalizeRiveConfig({}, "creek") } }, { db });
    await saveStep(draft.id, 3, { soul: { voice_md: VOICE, hard_rules_version: 1 } }, { db });
    await saveStep(draft.id, 4, { guardians: { emails: ["ana@example.org", "ben@example.org"] } }, { db });
    await saveStep(draft.id, 5, { fund: { skipped: true, note: null } }, { db });
    await expect(completeSummon(draft.id, { db, sendMail })).rejects.toMatchObject({ code: "binding_invalid" });
    const rows = await db.select().from(schema.entities).where(eq(schema.entities.slug, "boulder-creek-bad"));
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("refuses guardian addresses that are the creator's, or each other's", async () => {
    const draft = await createDraft("u-maya", { db });
    const tree = frontRangeTwin();
    const proposal = await proposeForPlace(tree, { place_id: "place/coal-creek-near-plainview-co", slug: "coal-creek", name: "Coal Creek" }, { db });
    await saveStep(draft.id, 1, { place: { ...proposal.place, validation: { ok: true, errors: [], warnings: [] } } }, { db });
    await saveStep(draft.id, 2, { parts: { rive_config: normalizeRiveConfig({}, "creek") } }, { db });
    await saveStep(draft.id, 3, { soul: { voice_md: VOICE, hard_rules_version: 1 } }, { db });
    await saveStep(draft.id, 5, { fund: { skipped: true, note: null } }, { db });

    await saveStep(draft.id, 4, { guardians: { emails: ["maya@example.org", "ben@example.org"] } }, { db });
    await expect(completeSummon(draft.id, { db, sendMail })).rejects.toMatchObject({ code: "guardians_invalid" });
    await saveStep(draft.id, 4, { guardians: { emails: ["ana@example.org", "ana@example.org"] } }, { db });
    await expect(completeSummon(draft.id, { db, sendMail })).rejects.toMatchObject({ code: "guardians_invalid" });
    await saveStep(draft.id, 4, { guardians: { emails: ["not-an-email", "ben@example.org"] } }, { db });
    await expect(completeSummon(draft.id, { db, sendMail })).rejects.toMatchObject({ code: "guardians_invalid" });
  }, 60_000);
});

describe("a second bioregion goes through the same flow", () => {
  it("summons a kami on the other twin without a Front Range assumption", async () => {
    const { writeOtherTwinTree, twinFromDir } = await import("./helpers");
    const dir = writeOtherTwinTree();
    await bindTwinTo(db, "salmon-creek", dir);
    const tree = twinFromDir(dir);
    const draft = await createDraft("u-maya", { db });
    const proposal = await proposeForPlace(tree, { place_id: "place/salmon-creek-at-tidewater-or", slug: "salmon-creek", name: "Salmon Creek" }, { db });
    expect(proposal.place.validation.ok).toBe(true);
    await saveStep(draft.id, 1, { place: proposal.place }, { db });
    await saveStep(draft.id, 2, { parts: { rive_config: normalizeRiveConfig({}, "creek") } }, { db });
    await saveStep(draft.id, 3, { soul: { voice_md: "You speak for Salmon Creek in short, dry sentences. You have one gauge and a lot of silence.", hard_rules_version: 1 } }, { db });
    await saveStep(draft.id, 4, { guardians: { emails: ["kai@example.org", "lee@example.org"] } }, { db });
    await saveStep(draft.id, 5, { fund: { skipped: true, note: null } }, { db });
    const result = await completeSummon(draft.id, { db, sendMail });
    expect(result.entity_id).toBe("entity/salmon-creek");
    expect(result.published).toBe(false);
    const loaded = await loadDraft(draft.id, "u-maya", { db });
    expect(loaded.step).toBe(DONE_STEP);
  }, 120_000);
});
