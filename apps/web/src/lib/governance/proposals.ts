/**
 * Human proposals (PRD §7.1 "any time"): anyone signed in may propose; the
 * entity ranks against its strategy and explains (through the platform MCP —
 * the agent context); stewards decide. Proposal text reaches the model only
 * through the MCP's structured listing, never as an instruction.
 */
import { and, eq, sql } from "drizzle-orm";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { assertEntityActive } from "./bounties";
import { GovernanceError } from "./errors";
import { requireEntityRole } from "./roles";
import { newId, withTx } from "./tx";

export const PROPOSAL_TITLE_MAX = 200;
export const PROPOSAL_BODY_MAX = 4000;
export const OPEN_PROPOSALS_PER_AUTHOR = 5;

const CONTROL_RE = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]", "g");

export function cleanText(s: string, max: number): string {
  return String(s ?? "").replace(CONTROL_RE, "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);
}

export async function createHumanProposal(db: DbOrTx, input: { entity_id: string; author_id: string; title: string; body_md: string }, deps: { now?: Date } = {}) {
  const now = deps.now ?? new Date();
  const title = cleanText(input.title, PROPOSAL_TITLE_MAX);
  const body = cleanText(input.body_md, PROPOSAL_BODY_MAX);
  if (title.length < 3 || body.length < 10) throw new GovernanceError("invalid_spec", "title or body too short");
  return withTx(db, async (tx) => {
    await assertEntityActive(tx, input.entity_id);
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.proposals)
      .where(and(eq(schema.proposals.entityId, input.entity_id), eq(schema.proposals.authorId, input.author_id), eq(schema.proposals.status, "open")));
    if ((open?.n ?? 0) >= OPEN_PROPOSALS_PER_AUTHOR) throw new GovernanceError("claim_limit", "too many open proposals");
    const id = newId("prop");
    const [row] = await tx
      .insert(schema.proposals)
      .values({ id, entityId: input.entity_id, authorKind: "human", authorId: input.author_id, title, bodyMd: body, status: "open", createdAt: now })
      .returning();
    await appendEntityEvent(tx, { entity_id: input.entity_id, actor: input.author_id, kind: "proposal_created", payload: { proposal_id: id, author_kind: "human", title_len: title.length, body_len: body.length }, at: now });
    return row!;
  });
}

export type RankContext = { kind: "agent"; token_entity_id?: string } | { kind: "user"; user_id: string };

/** Only the platform MCP (agent context) or a steward may rank. The reason is the entity's own words and is rendered `data-generated="ai"`. */
export async function rankProposal(db: DbOrTx, id: string, rank: number, reason: string, ctx: RankContext, deps: { now?: Date } = {}) {
  const now = deps.now ?? new Date();
  if (!Number.isInteger(rank) || rank < 1 || rank > 1000) throw new GovernanceError("invalid_spec", "rank must be a positive integer");
  const reasonMd = cleanText(reason, 2000);
  return withTx(db, async (tx) => {
    const [p] = await tx.select().from(schema.proposals).where(eq(schema.proposals.id, id)).limit(1);
    if (!p || !p.entityId) throw new GovernanceError("not_found");
    let actor: string | null;
    if (ctx.kind === "agent") {
      if (ctx.token_entity_id && ctx.token_entity_id !== p.entityId) throw new GovernanceError("forbidden");
      actor = `agent:${p.entityId}`;
    } else {
      await requireEntityRole(tx, ctx.user_id, p.entityId, ["steward"]);
      actor = ctx.user_id;
    }
    const [row] = await tx.update(schema.proposals).set({ rank, rankReasonMd: reasonMd }).where(eq(schema.proposals.id, id)).returning();
    await appendEntityEvent(tx, { entity_id: p.entityId, actor, kind: "proposal_ranked", payload: { proposal_id: id, rank, previous_rank: p.rank, by: ctx.kind }, at: now });
    return row!;
  });
}

export async function decideProposal(db: DbOrTx, id: string, decision: "accepted" | "declined", stewardId: string, deps: { now?: Date; note?: string } = {}) {
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const [p] = await tx.select().from(schema.proposals).where(eq(schema.proposals.id, id)).limit(1);
    if (!p || !p.entityId) throw new GovernanceError("not_found");
    await requireEntityRole(tx, stewardId, p.entityId, ["steward"]);
    if (p.status !== "open") throw new GovernanceError("invalid_transition", `${p.status} → ${decision}`);
    const [row] = await tx.update(schema.proposals).set({ status: decision }).where(eq(schema.proposals.id, id)).returning();
    await appendEntityEvent(tx, { entity_id: p.entityId, actor: stewardId, kind: `proposal_${decision}`, payload: { proposal_id: id, note: deps.note ?? null }, at: now });
    return row!;
  });
}
