/** PRD phase-three funding calls: organize proposals, without inventing voting or payouts. */
import { grantsBackendCopy as c } from "@/copy/grants";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { hatCheck, isPlatformAdmin, requireEntityRole } from "@/lib/governance/roles";
import { newId } from "@/lib/governance/tx";
export class GrantError extends Error {
}
const inputSchema = z.object({ title: z.string().trim().min(3).max(200), purposeMd: z.string().trim().min(10).max(4000), budgetUsdc: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).refine(v => Number(v) > 0), applicationDeadline: z.string().datetime({ offset: true }) });
async function manager(db: DbOrTx, userId: string | null, entityId: string) {
    return Boolean(userId && (await isPlatformAdmin(db, userId) || await hatCheck(db, entityId, userId, "steward") || await hatCheck(db, entityId, userId, "guardian")));
}
async function entityRow(db: DbOrTx, id: string, lock = false) {
    const query = db.select().from(schema.entities).where(eq(schema.entities.id, id)).limit(1);
    const [entity] = await (lock ? query.for("update") : query);
    if (!entity)
        throw new GrantError(c.notFound);
    return entity;
}
function canPublish(entity: typeof schema.entities.$inferSelect) {
    if (entity.retiredAt)
        throw new GrantError(c.retired);
    if (entity.pausedAt)
        throw new GrantError(c.paused);
    if (!entity.publishedAt)
        throw new GrantError(c.notPublic);
}
export async function createGrantRound(db: DbOrTx, input: {
    entityId: string;
    userId: string;
    title: string;
    purposeMd: string;
    budgetUsdc: string;
    applicationDeadline: string;
}, deps: {
    now?: Date;
} = {}) {
    const now = deps.now ?? new Date();
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success)
        throw new GrantError(c.invalid);
    if (new Date(parsed.data.applicationDeadline) <= now)
        throw new GrantError(c.future);
    return db.transaction(async (tx) => {
        const entity = await entityRow(tx, input.entityId, true);
        await requireEntityRole(tx, input.userId, entity.id, ["guardian", "steward"]);
        if (entity.retiredAt)
            throw new GrantError(c.retired);
        const [round] = await tx.insert(schema.grantRounds).values({ id: newId("grant"), entityId: entity.id, ...parsed.data, budgetUsdc: Number(parsed.data.budgetUsdc).toFixed(2), applicationDeadline: new Date(parsed.data.applicationDeadline), createdBy: input.userId, createdAt: now }).returning();
        await appendEntityEvent(tx, { entity_id: entity.id, actor: input.userId, kind: "grant_round.drafted", payload: { round_id: round!.id, budget_usdc: round!.budgetUsdc, application_deadline: round!.applicationDeadline.toISOString(), budget_is_reserved: false }, at: now });
        return round!;
    });
}
export async function setGrantRoundStatus(db: DbOrTx, input: {
    entityId: string;
    userId: string;
    roundId: string;
    status: "open" | "closed";
}, deps: {
    now?: Date;
} = {}) {
    return db.transaction(async (tx) => {
        const entity = await entityRow(tx, input.entityId, true);
        await requireEntityRole(tx, input.userId, entity.id, ["guardian", "steward"]);
        const [round] = await tx.select().from(schema.grantRounds).where(and(eq(schema.grantRounds.id, input.roundId), eq(schema.grantRounds.entityId, entity.id))).limit(1).for("update");
        if (!round)
            throw new GrantError(c.roundNotFound);
        // Read the clock after waiting for entity and round locks.
        const now = deps.now ?? new Date();
        if (input.status === "open") {
            canPublish(entity);
            if (round.status !== "draft")
                throw new GrantError(c.onlyDraft);
            if (round.applicationDeadline <= now)
                throw new GrantError(c.deadline);
        }
        else if (input.status !== "closed" || round.status === "closed")
            throw new GrantError(c.transition);
        const [updated] = await tx.update(schema.grantRounds).set({ status: input.status, ...(input.status === "open" ? { openedAt: now } : { closedAt: now }) }).where(eq(schema.grantRounds.id, round.id)).returning();
        await appendEntityEvent(tx, { entity_id: entity.id, actor: input.userId, kind: `grant_round.${input.status}`, payload: { round_id: round.id, previous_status: round.status }, at: now });
        return updated!;
    });
}
export async function applyToGrantRound(db: DbOrTx, input: {
    entityId: string;
    userId: string;
    roundId: string;
    proposalId: string;
}, deps: {
    now?: Date;
} = {}) {
    return db.transaction(async (tx) => {
        const entity = await entityRow(tx, input.entityId, true);
        canPublish(entity);
        const [user] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, input.userId)).limit(1);
        if (!user)
            throw new GrantError(c.signInApply);
        const [round] = await tx.select().from(schema.grantRounds).where(and(eq(schema.grantRounds.id, input.roundId), eq(schema.grantRounds.entityId, entity.id))).limit(1).for("update");
        if (!round || round.status !== "open")
            throw new GrantError(c.notAccepting);
        const [proposal] = await tx.select().from(schema.proposals).where(and(eq(schema.proposals.id, input.proposalId), eq(schema.proposals.entityId, entity.id), eq(schema.proposals.authorId, input.userId), eq(schema.proposals.authorKind, "human"), eq(schema.proposals.status, "open"))).limit(1).for("update");
        if (!proposal)
            throw new GrantError(c.ownProposal);
        // A request may have waited behind moderation or a proposal edit.
        const now = deps.now ?? new Date();
        if (round.applicationDeadline <= now)
            throw new GrantError(c.notAccepting);
        const [application] = await tx.insert(schema.grantApplications).values({ roundId: round.id, proposalId: proposal.id, submittedBy: input.userId, submittedAt: now }).onConflictDoNothing().returning();
        if (application)
            await appendEntityEvent(tx, { entity_id: entity.id, actor: input.userId, kind: "grant_round.application_submitted", payload: { round_id: round.id, proposal_id: proposal.id }, at: now });
        return { roundId: round.id, proposalId: proposal.id, created: Boolean(application) };
    });
}
export type GrantRoundView = typeof schema.grantRounds.$inferSelect & {
    acceptingApplications: boolean;
    applications: {
        proposalId: string;
        title: string;
        status: string;
        bountyIds: string[];
    }[];
};
export async function getGrantBoard(db: DbOrTx, entityId: string, viewerId: string | null, now = new Date()): Promise<{
    mayManage: boolean;
    rounds: GrantRoundView[];
    eligibleProposals: {
        id: string;
        title: string;
    }[];
}> {
    const entity = await entityRow(db, entityId);
    const mayManage = await manager(db, viewerId, entityId);
    const mayPreview = mayManage || Boolean(viewerId && await hatCheck(db, entityId, viewerId, "evaluator"));
    if (!entity.publishedAt && !mayPreview)
        throw new GrantError(c.notPublic);
    const rounds = await db.select().from(schema.grantRounds).where(and(eq(schema.grantRounds.entityId, entityId), mayManage ? undefined : and(inArray(schema.grantRounds.status, ["open", "closed"]), isNotNull(schema.grantRounds.openedAt)))).orderBy(desc(schema.grantRounds.createdAt)).limit(100);
    const applications = rounds.length ? await db.select({ roundId: schema.grantApplications.roundId, proposalId: schema.proposals.id, title: schema.proposals.title, status: schema.proposals.status }).from(schema.grantApplications).innerJoin(schema.proposals, eq(schema.proposals.id, schema.grantApplications.proposalId)).where(and(inArray(schema.grantApplications.roundId, rounds.map(r => r.id)), eq(schema.proposals.entityId, entityId))) : [];
    const bounties = applications.length ? await db.select({ id: schema.bounties.id, proposalId: schema.bounties.proposalId }).from(schema.bounties).where(and(eq(schema.bounties.entityId, entityId), mayManage ? undefined : inArray(schema.bounties.status, ["open", "claimed", "in_review", "paid", "deferred", "expired", "withdrawn"]), inArray(schema.bounties.proposalId, applications.map(a => a.proposalId)))) : [];
    const eligibleProposals = viewerId ? await db.select({ id: schema.proposals.id, title: schema.proposals.title }).from(schema.proposals).where(and(eq(schema.proposals.entityId, entityId), eq(schema.proposals.authorId, viewerId), eq(schema.proposals.authorKind, "human"), eq(schema.proposals.status, "open"))) : [];
    return { mayManage, eligibleProposals, rounds: rounds.map(r => ({ ...r, acceptingApplications: r.status === "open" && r.applicationDeadline > now && !entity.pausedAt && !entity.retiredAt && Boolean(entity.publishedAt), applications: applications.filter(a => a.roundId === r.id).map(a => ({ proposalId: a.proposalId, title: a.title, status: a.status, bountyIds: bounties.filter(b => b.proposalId === a.proposalId).map(b => b.id) })) })) };
}
