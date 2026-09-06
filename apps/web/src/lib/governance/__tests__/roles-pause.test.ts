import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listEntityEvents, verifyEventChain } from "@/db/events";
import {
  acceptInvite,
  entityHasTwoNonFounderGuardians,
  grantRole,
  hashToken,
  hatCheck,
  inviteGuardian,
  revokeRole,
  setHatResolver,
} from "../roles";
import { pauseEntity, pauseState, requestResume, retireEntity } from "../pause";
import { closeTestDb, createTestDb, seedEntity, seedUser, seedWorld, addRole, type TestDb, type World } from "./helpers";

let db: TestDb;
let w: World;
const mails: Array<{ email: string; url: string; entityName: string }> = [];
const sendMail = async (m: { email: string; url: string; entityName: string }) => {
  mails.push(m);
};

beforeAll(async () => {
  db = await createTestDb();
  w = await seedWorld(db);
});
afterAll(async () => {
  setHatResolver(null);
  await closeTestDb(db);
});

describe("guardian invites (T1.10)", () => {
  it("stores only a hash of the token and mails a 7-day link", async () => {
    const invitee = await seedUser(db, "u-invitee", "invitee@example.org");
    const now = new Date("2026-09-06T00:00:00Z");
    const inv = await inviteGuardian(db, { entity_id: w.entityId, email: "Invitee@Example.org", invited_by: w.guardianA, base_url: "https://kami.test" }, { sendMail, now, token: "tok-1" });
    expect(inv.expires_at.toISOString()).toBe("2026-09-13T00:00:00.000Z");
    expect(mails.at(-1)!.url).toBe("https://kami.test/guardian/accept?token=tok-1");
    const [row] = await db.select().from(schema.guardianInvites).where(eq(schema.guardianInvites.id, inv.id));
    expect(row!.tokenHash).toBe(hashToken("tok-1"));
    expect(row!.tokenHash).not.toContain("tok-1");
    expect(row!.email).toBe("invitee@example.org");
    // the event records a hash of the email, never the address itself
    const ev = (await listEntityEvents(db, w.entityId)).filter((e) => e.kind === "guardian_invited").at(-1)!;
    expect(JSON.stringify(ev.payload)).not.toContain("invitee@example.org");
    void invitee;
  });

  it("accepts the invitation and records entity_roles.accepted_at", async () => {
    await inviteGuardian(db, { entity_id: w.entityId, email: "invitee@example.org", invited_by: w.guardianA }, { sendMail, token: "tok-2" });
    const res = await acceptInvite(db, "tok-2", "u-invitee");
    expect(res.entity_id).toBe(w.entityId);
    const [role] = await db
      .select()
      .from(schema.entityRoles)
      .where(and(eq(schema.entityRoles.entityId, w.entityId), eq(schema.entityRoles.userId, "u-invitee"), eq(schema.entityRoles.role, "guardian")));
    expect(role!.acceptedAt).not.toBeNull();
  });

  it("refuses a token that has already been used, an unknown token, and an expired one", async () => {
    await expect(acceptInvite(db, "tok-2", "u-invitee")).rejects.toThrow(/invite_invalid/);
    await expect(acceptInvite(db, "never-issued", "u-invitee")).rejects.toThrow(/invite_invalid/);
    const past = new Date("2026-08-01T00:00:00Z");
    await inviteGuardian(db, { entity_id: w.entityId, email: "invitee@example.org", invited_by: w.guardianA }, { sendMail, token: "tok-old", now: past });
    await expect(acceptInvite(db, "tok-old", "u-invitee", { now: new Date("2026-09-06T00:00:00Z") })).rejects.toThrow(/invite_expired/);
  });

  it("refuses acceptance by a different email than the one invited", async () => {
    await seedUser(db, "u-someone-else", "else@example.org");
    await inviteGuardian(db, { entity_id: w.entityId, email: "invitee@example.org", invited_by: w.guardianA }, { sendMail, token: "tok-3" });
    await expect(acceptInvite(db, "tok-3", "u-someone-else")).rejects.toThrow(/invite_email_mismatch/);
  });

  it("refuses an invitation from someone who is not a guardian or steward", async () => {
    await expect(inviteGuardian(db, { entity_id: w.entityId, email: "x@example.org", invited_by: w.contributor }, { sendMail })).rejects.toThrow(/forbidden/);
  });
});

describe("roles: grant, revoke, and the G8 rule", () => {
  it("grants and revokes a role, writing an event each time", async () => {
    const person = await seedUser(db, "u-new-evaluator");
    await grantRole(db, { entity_id: w.entityId, user_id: person.id, role: "evaluator", by: w.founder });
    const [row] = await db
      .select()
      .from(schema.entityRoles)
      .where(and(eq(schema.entityRoles.userId, person.id), eq(schema.entityRoles.role, "evaluator")));
    expect(row!.acceptedAt).not.toBeNull();
    await revokeRole(db, { entity_id: w.entityId, user_id: person.id, role: "evaluator", by: w.founder, reason: "stepped down" });
    const [after] = await db
      .select()
      .from(schema.entityRoles)
      .where(and(eq(schema.entityRoles.userId, person.id), eq(schema.entityRoles.role, "evaluator")));
    expect(after!.revokedAt).not.toBeNull();
    const kinds = (await listEntityEvents(db, w.entityId)).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["role_granted", "role_revoked"]));
  });

  it("counts two accepted guardians besides the founder (PRD G8)", async () => {
    const solo = await seedEntity(db, { slug: "solo-creek" });
    const founder = await seedUser(db, "u-solo-founder");
    await db.update(schema.entities).set({ createdBy: founder.id }).where(eq(schema.entities.id, solo.id));
    await addRole(db, solo.id, founder.id, "guardian");
    expect(await entityHasTwoNonFounderGuardians(db, solo.id)).toBe(false);

    const g1 = await seedUser(db, "u-solo-g1");
    await addRole(db, solo.id, g1.id, "guardian");
    expect(await entityHasTwoNonFounderGuardians(db, solo.id)).toBe(false);

    const g2 = await seedUser(db, "u-solo-g2");
    await addRole(db, solo.id, g2.id, "guardian", { accepted: false });
    expect(await entityHasTwoNonFounderGuardians(db, solo.id), "an invited-but-not-accepted guardian does not count").toBe(false);

    await addRole(db, solo.id, g2.id, "guardian", { accepted: true });
    expect(await entityHasTwoNonFounderGuardians(db, solo.id)).toBe(true);

    await revokeRole(db, { entity_id: solo.id, user_id: g2.id, role: "guardian", by: founder.id });
    expect(await entityHasTwoNonFounderGuardians(db, solo.id)).toBe(false);
  });
});

describe("hatCheck (phase 2; the DB row is the invitation, the hat is the authority)", () => {
  it("passes when no hat_id is recorded", async () => {
    expect(await hatCheck(db, w.entityId, w.evaluator, "evaluator")).toBe(true);
  });

  it("fails closed when a hat is recorded but no on-chain resolver is wired", async () => {
    const wearer = await seedUser(db, "u-hat-wearer");
    await addRole(db, w.entityId, wearer.id, "evaluator", { hatId: "42" });
    expect(await hatCheck(db, w.entityId, wearer.id, "evaluator")).toBe(false);
  });

  it("asks the resolver — isWearerOfHat — once one is set", async () => {
    const asked: string[] = [];
    setHatResolver(async (hatId) => {
      asked.push(hatId);
      return hatId === "42";
    });
    try {
      expect(await hatCheck(db, w.entityId, "u-hat-wearer", "evaluator")).toBe(true);
      expect(asked).toEqual(["42"]);
    } finally {
      setHatResolver(null);
    }
  });

  it("fails closed when the resolver throws", async () => {
    setHatResolver(async () => {
      throw new Error("rpc down");
    });
    try {
      expect(await hatCheck(db, w.entityId, "u-hat-wearer", "evaluator")).toBe(false);
    } finally {
      setHatResolver(null);
    }
  });

  it("is false for someone with no role at all", async () => {
    expect(await hatCheck(db, w.entityId, w.contributor, "evaluator")).toBe(false);
  });
});

describe("pause, resume and retire (ADR-E12: one pauses, two resume)", () => {
  it("lets one guardian pause and records pause_events plus entities.paused_at", async () => {
    const e = await seedEntity(db, { slug: "pause-creek" });
    const [gA, gB] = [await seedUser(db, "u-pause-a"), await seedUser(db, "u-pause-b")];
    await addRole(db, e.id, gA.id, "guardian");
    await addRole(db, e.id, gB.id, "guardian");

    const res = await pauseEntity(db, e.id, gA.id);
    expect(res.already).toBe(false);
    const [row] = await db.select().from(schema.entities).where(eq(schema.entities.id, e.id));
    expect(row!.pausedAt).not.toBeNull();
    const events = await db.select().from(schema.pauseEvents).where(eq(schema.pauseEvents.entityId, e.id));
    expect(events.map((x) => x.action)).toEqual(["pause"]);
    expect((await listEntityEvents(db, e.id)).map((x) => x.kind)).toContain("paused");
  });

  it("needs two distinct guardians within 24 h to resume", async () => {
    const e = await seedEntity(db, { slug: "resume-creek" });
    const [gA, gB] = [await seedUser(db, "u-resume-a"), await seedUser(db, "u-resume-b")];
    await addRole(db, e.id, gA.id, "guardian");
    await addRole(db, e.id, gB.id, "guardian");
    await pauseEntity(db, e.id, gA.id);

    const first = await requestResume(db, e.id, gA.id);
    expect(first.resumed).toBe(false);
    expect(first.requesters).toHaveLength(1);
    // the same guardian cannot make up the second request
    await expect(requestResume(db, e.id, gA.id)).rejects.toThrow(/already_requested/);
    let [row] = await db.select().from(schema.entities).where(eq(schema.entities.id, e.id));
    expect(row!.pausedAt, "still paused on one request").not.toBeNull();

    const second = await requestResume(db, e.id, gB.id);
    expect(second.resumed).toBe(true);
    [row] = await db.select().from(schema.entities).where(eq(schema.entities.id, e.id));
    expect(row!.pausedAt).toBeNull();
    const actions = (await db.select().from(schema.pauseEvents).where(eq(schema.pauseEvents.entityId, e.id))).map((x) => x.action);
    expect(actions).toEqual(["pause", "resume_request", "resume_request", "resume"]);
  });

  it("ignores a resume request older than the 24 h window", async () => {
    const e = await seedEntity(db, { slug: "stale-resume-creek" });
    const [gA, gB] = [await seedUser(db, "u-stale-a"), await seedUser(db, "u-stale-b")];
    await addRole(db, e.id, gA.id, "guardian");
    await addRole(db, e.id, gB.id, "guardian");
    const t0 = new Date("2026-09-01T00:00:00Z");
    await pauseEntity(db, e.id, gA.id, { now: t0 });
    await requestResume(db, e.id, gA.id, { now: new Date("2026-09-01T01:00:00Z") });
    const late = await requestResume(db, e.id, gB.id, { now: new Date("2026-09-03T01:00:00Z") });
    expect(late.resumed, "the first request has aged out").toBe(false);
    const [row] = await db.select().from(schema.entities).where(eq(schema.entities.id, e.id));
    expect(row!.pausedAt).not.toBeNull();
  });

  it("refuses a resume request from a non-guardian and on an entity that is not paused", async () => {
    const e = await seedEntity(db, { slug: "unpaused-creek" });
    const g = await seedUser(db, "u-unpaused-g");
    const stranger = await seedUser(db, "u-unpaused-stranger");
    await addRole(db, e.id, g.id, "guardian");
    await expect(requestResume(db, e.id, g.id)).rejects.toThrow(/not_paused/);
    await pauseEntity(db, e.id, g.id);
    await expect(requestResume(db, e.id, stranger.id)).rejects.toThrow(/forbidden/);
  });

  it("retires on two guardians, pausing as it goes and recording the treasury's to-do", async () => {
    const e = await seedEntity(db, { slug: "retire-creek" });
    const [gA, gB] = [await seedUser(db, "u-retire-a"), await seedUser(db, "u-retire-b")];
    await addRole(db, e.id, gA.id, "guardian");
    await addRole(db, e.id, gB.id, "guardian");

    const first = await retireEntity(db, e.id, gA.id);
    expect(first.retired).toBe(false);
    await expect(retireEntity(db, e.id, gA.id)).rejects.toThrow(/already_requested/);
    const second = await retireEntity(db, e.id, gB.id);
    expect(second.retired).toBe(true);

    const [row] = await db.select().from(schema.entities).where(eq(schema.entities.id, e.id));
    expect(row!.retiredAt).not.toBeNull();
    expect(row!.pausedAt).not.toBeNull();
    const kinds = (await listEntityEvents(db, e.id)).map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["retire_requested", "paused", "retired"]));
    const req = (await listEntityEvents(db, e.id)).find((x) => x.kind === "retire_requested")!;
    expect(JSON.stringify(req.payload)).toMatch(/withdraw Safe to steward wrapper/);
    expect(await verifyEventChain(db, e.id)).toMatchObject({ ok: true });
  });

  it("reports the current pause state for the guardian page", async () => {
    const e = await seedEntity(db, { slug: "state-creek" });
    const g = await seedUser(db, "u-state-g");
    await addRole(db, e.id, g.id, "guardian");
    await pauseEntity(db, e.id, g.id);
    await requestResume(db, e.id, g.id);
    const state = await pauseState(db, e.id);
    expect(state.paused_at).not.toBeNull();
    expect(state.resume_requests).toHaveLength(1);
    expect(state.window_hours).toBe(24);
  });
});
