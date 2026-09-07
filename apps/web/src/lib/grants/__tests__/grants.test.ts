import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, seedEntity, seedUser, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { verifyEventChain } from "@/db/events";
import { createGrantRound, setGrantRoundStatus, applyToGrantRound, getGrantBoard } from "../index";
let db: TestDb;
const now = new Date("2026-09-07T12:00:00Z");
const entityId = "entity/grant-creek";
const draft = () => createGrantRound(db, { entityId, userId: "steward", title: "Creek observation projects", purposeMd: "Support careful community observations of the creek.", budgetUsdc: "400.50", applicationDeadline: "2026-09-14T12:00:00Z" }, { now });
beforeAll(async () => {
    db = await createTestDb();
    await seedEntity(db, { slug: "grant-creek", consultationDone: true });
    await seedEntity(db, { slug: "foreign-creek", consultationDone: true });
    for (const id of ["steward", "applicant", "stranger"])
        await seedUser(db, id);
    await db.insert(schema.entityRoles).values({ entityId, userId: "steward", role: "steward", acceptedAt: now });
    await db.insert(schema.proposals).values([{ id: "grant-proposal", entityId, authorKind: "human", authorId: "applicant", title: "Document observations", bodyMd: "A real proposal for this round." }, { id: "foreign-proposal", entityId: "entity/foreign-creek", authorKind: "human", authorId: "applicant", title: "Other creek project", bodyMd: "This belongs elsewhere." }]);
});
afterAll(async () => closeTestDb(db));
describe("grant round lifecycle", () => {
    it("rejects unauthorized moderation and hides drafts from public viewers", async () => {
        const round = await draft();
        await expect(setGrantRoundStatus(db, { entityId, userId: "stranger", roundId: round.id, status: "open" }, { now })).rejects.toThrow();
        expect((await getGrantBoard(db, entityId, null, now)).rounds.some(r => r.id === round.id)).toBe(false);
        expect((await getGrantBoard(db, entityId, "steward", now)).rounds.some(r => r.id === round.id)).toBe(true);
    });
    it("opens a round, links only the applicant’s same-entity proposal, closes and preserves audit", async () => {
        const round = await draft();
        await setGrantRoundStatus(db, { entityId, userId: "steward", roundId: round.id, status: "open" }, { now });
        await expect(applyToGrantRound(db, { entityId, userId: "stranger", roundId: round.id, proposalId: "grant-proposal" }, { now })).rejects.toThrow("own open proposal");
        await expect(applyToGrantRound(db, { entityId, userId: "applicant", roundId: round.id, proposalId: "foreign-proposal" }, { now })).rejects.toThrow("own open proposal");
        expect((await applyToGrantRound(db, { entityId, userId: "applicant", roundId: round.id, proposalId: "grant-proposal" }, { now })).created).toBe(true);
        expect((await applyToGrantRound(db, { entityId, userId: "applicant", roundId: round.id, proposalId: "grant-proposal" }, { now })).created).toBe(false);
        const board = await getGrantBoard(db, entityId, null, now);
        expect(board.rounds.find(r => r.id === round.id)?.applications).toEqual([{ proposalId: "grant-proposal", title: "Document observations", status: "open", bountyIds: [] }]);
        await setGrantRoundStatus(db, { entityId, userId: "steward", roundId: round.id, status: "closed" }, { now });
        await expect(applyToGrantRound(db, { entityId, userId: "applicant", roundId: round.id, proposalId: "grant-proposal" }, { now })).rejects.toThrow("not accepting");
        expect((await verifyEventChain(db, entityId)).ok).toBe(true);
        expect(await db.select().from(schema.payouts)).toHaveLength(0);
        expect(await db.select().from(schema.safeProposals)).toHaveLength(0);
    });
    it("enforces the deadline at its exact instant without waiting for a cron", async () => {
        const round = await draft();
        await setGrantRoundStatus(db, { entityId, userId: "steward", roundId: round.id, status: "open" }, { now });
        const deadline = round.applicationDeadline;
        expect((await getGrantBoard(db, entityId, null, deadline)).rounds.find(r => r.id === round.id)?.acceptingApplications).toBe(false);
        await expect(applyToGrantRound(db, { entityId, userId: "applicant", roundId: round.id, proposalId: "grant-proposal" }, { now: deadline })).rejects.toThrow("not accepting");
        const another = await draft();
        await expect(setGrantRoundStatus(db, { entityId, userId: "steward", roundId: another.id, status: "open" }, { now: deadline })).rejects.toThrow("deadline");
    });
    it("allows private paused preparation but refuses publication and foreign round mutations", async () => {
        await db.update(schema.entities).set({ pausedAt: now, consultationDoneAt: null }).where(eq(schema.entities.id, entityId));
        try {
            const round = await draft();
            await expect(getGrantBoard(db, entityId, null, now)).rejects.toThrow("not public");
            await expect(setGrantRoundStatus(db, { entityId, userId: "steward", roundId: round.id, status: "open" }, { now })).rejects.toThrow("paused");
            await setGrantRoundStatus(db, { entityId, userId: "steward", roundId: round.id, status: "closed" }, { now });
        }
        finally {
            await db.update(schema.entities).set({ pausedAt: null, consultationDoneAt: now }).where(eq(schema.entities.id, entityId));
        }
        const round = await draft();
        await expect(setGrantRoundStatus(db, { entityId: "entity/foreign-creek", userId: "steward", roundId: round.id, status: "closed" }, { now })).rejects.toThrow();
    });
    it("database trigger independently refuses cross-entity applications", async () => {
        const round = await draft();
        await expect(db.insert(schema.grantApplications).values({ roundId: round.id, proposalId: "foreign-proposal", submittedBy: "applicant" })).rejects.toThrow();
    });
    it("never exposes a draft closed without publication or its private bounty links", async () => {
        const privateRound = await draft();
        await setGrantRoundStatus(db, { entityId, userId: "steward", roundId: privateRound.id, status: "closed" }, { now });
        expect((await getGrantBoard(db, entityId, null, now)).rounds.some(r => r.id === privateRound.id)).toBe(false);
        const round = await draft();
        await setGrantRoundStatus(db, { entityId, userId: "steward", roundId: round.id, status: "open" }, { now });
        await applyToGrantRound(db, { entityId, userId: "applicant", roundId: round.id, proposalId: "grant-proposal" }, { now });
        await db.insert(schema.bounties).values({ id: "private-grant-bounty", entityId, proposalId: "grant-proposal", title: "Unapproved work", whyMd: "Draft only", deliverableMd: "Not yet approved", verificationTier: 2, evidenceSpec: {}, capUsdc: "25.00", twinRefs: [], specSha256: "0".repeat(64), status: "drafted" });
        expect((await getGrantBoard(db, entityId, null, now)).rounds.find(r => r.id === round.id)?.applications[0]?.bountyIds).toEqual([]);
        expect((await getGrantBoard(db, entityId, "steward", now)).rounds.find(r => r.id === round.id)?.applications[0]?.bountyIds).toEqual(["private-grant-bounty"]);
    });
    it("rechecks real time after a request waits to enter its transaction", async () => {
        const round = await draft();
        const original = db.transaction.bind(db);
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(now);
        const delayed = vi.spyOn(db, "transaction").mockImplementation(async (callback, ...rest) => {
            vi.setSystemTime(round.applicationDeadline);
            return original(callback, ...rest);
        });
        try {
            await expect(setGrantRoundStatus(db, { entityId, userId: "steward", roundId: round.id, status: "open" })).rejects.toThrow("deadline");
        }
        finally {
            delayed.mockRestore();
            vi.useRealTimers();
        }
        await setGrantRoundStatus(db, { entityId, userId: "steward", roundId: round.id, status: "open" }, { now });
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(now);
        const delayedApply = vi.spyOn(db, "transaction").mockImplementation(async (callback, ...rest) => {
            vi.setSystemTime(round.applicationDeadline);
            return original(callback, ...rest);
        });
        try {
            await expect(applyToGrantRound(db, { entityId, userId: "applicant", roundId: round.id, proposalId: "grant-proposal" })).rejects.toThrow("not accepting");
        }
        finally {
            delayedApply.mockRestore();
            vi.useRealTimers();
        }
    });
    it("migration grants the application role table privileges", async () => {
        const result = await db.$client.query<{
            allowed: boolean;
        }>("select has_table_privilege('kami_app','grant_rounds','SELECT,INSERT,UPDATE,DELETE') and has_table_privilege('kami_app','grant_applications','SELECT,INSERT,UPDATE,DELETE') as allowed");
        expect(result.rows[0]?.allowed).toBe(true);
    });
});
