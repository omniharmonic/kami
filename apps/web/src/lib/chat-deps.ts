/**
 * Production `ChatDeps`: Neon-backed sessions and messages with an in-memory
 * fallback so development works with no database at all.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { getEntityBySlug, getConfigNumber } from "./entities";
import { chatCompletion } from "./gateway";
import { checkChatLimits } from "./ratelimit";
import { DEFAULT_REMINDER_EVERY, type ChatDeps, type ChatSessionRef } from "./chat-handler";

const memorySessions = new Map<string, ChatSessionRef & { startedAt: number }>();
const HOUR = 60 * 60 * 1000;

export const productionChatDeps: ChatDeps = {
  async getEntity(slug) {
    const e = await getEntityBySlug(slug);
    return e && !e.retired ? { id: e.id, slug: e.slug, name: e.name, archetype: e.archetype, paused: e.paused } : null;
  },

  async getOrCreateSession({ entityId, anonKey, userId, ipHash }) {
    const key = `${entityId}|${userId ?? `anon:${anonKey ?? "none"}`}`;
    const db = getDb();
    if (db) {
      try {
        const since = new Date(Date.now() - HOUR);
        const where = userId
          ? and(eq(schema.chatSessions.entityId, entityId), eq(schema.chatSessions.userId, userId), gte(schema.chatSessions.startedAt, since))
          : and(eq(schema.chatSessions.entityId, entityId), eq(schema.chatSessions.anonKey, anonKey ?? ""), gte(schema.chatSessions.startedAt, since));
        const [existing] = await db.select().from(schema.chatSessions).where(where).orderBy(desc(schema.chatSessions.startedAt)).limit(1);
        if (existing) return { id: existing.id, turns: existing.turns ?? 0 };
        const id = randomUUID();
        // Only reference users(id) when the entity row exists in this DB; a status-file-only entity has no FK target.
        const [entityRow] = await db.select({ id: schema.entities.id }).from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
        await db.insert(schema.chatSessions).values({ id, entityId: entityRow ? entityId : null, userId, anonKey: userId ? null : anonKey, ipHash, turns: 0 });
        return { id, turns: 0 };
      } catch (err) {
        console.warn("[chat] session store failed, using memory:", (err as Error).message);
      }
    }
    const now = Date.now();
    const m = memorySessions.get(key);
    if (m && now - m.startedAt < HOUR) return m;
    const fresh = { id: randomUUID(), turns: 0, startedAt: now };
    memorySessions.set(key, fresh);
    return fresh;
  },

  async checkLimits({ sessionId, ipHash }) {
    return checkChatLimits({ sessionId, ipHash, db: getDb() });
  },

  async reminderEvery() {
    return getConfigNumber("reminder_every_turns", DEFAULT_REMINDER_EVERY);
  },

  async gateway({ slug, messages, user }) {
    return chatCompletion({ slug, messages, user });
  },

  async persistTurn({ sessionId, turn, user, assistant, toolcalls, guard_dropped, reminder, state }) {
    for (const m of memorySessions.values()) if (m.id === sessionId) m.turns = turn;
    const db = getDb();
    if (!db) return;
    await db.transaction(async (tx) => {
      await tx.update(schema.chatSessions).set({ turns: turn }).where(eq(schema.chatSessions.id, sessionId));
      await tx.insert(schema.chatMessages).values({ sessionId, role: "user", content: user });
      if (state === "asleep") {
        await tx.insert(schema.chatMessages).values({ sessionId, role: "system", content: "asleep", toolcalls: null, guardDropped: 0 });
      } else {
        await tx.insert(schema.chatMessages).values({ sessionId, role: "assistant", content: assistant, toolcalls: toolcalls ?? null, guardDropped: guard_dropped });
      }
      if (reminder) await tx.insert(schema.chatMessages).values({ sessionId, role: "system", content: "reminder", reminder: true });
    });
  },
};
