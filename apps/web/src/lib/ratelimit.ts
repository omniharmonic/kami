/**
 * Chat rate limits (architecture §5.5): 20 turns per session per hour and
 * 60 per day per IP. Two layers: an in-memory sliding window (fast, per
 * instance) and a DB count over `chat_messages` (authoritative across
 * instances). Either layer refusing is a refusal.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export const LIMITS = {
  sessionPerHour: 20,
  ipPerDay: 60,
} as const;

export type LimitResult = { ok: true } | { ok: false; reason: "session_hour" | "ip_day"; retry_after_s: number };

type Window = { hits: number[] };

export function createMemoryLimiter(now: () => number = Date.now) {
  const windows = new Map<string, Window>();
  function check(key: string, limit: number, windowMs: number): { ok: boolean; retry_after_s: number } {
    const t = now();
    const w = windows.get(key) ?? { hits: [] };
    w.hits = w.hits.filter((h) => t - h < windowMs);
    if (w.hits.length >= limit) {
      const oldest = w.hits[0]!;
      return { ok: false, retry_after_s: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)) };
    }
    w.hits.push(t);
    windows.set(key, w);
    if (windows.size > 50_000) windows.clear(); // crude bound; the DB layer is authoritative
    return { ok: true, retry_after_s: 0 };
  }
  return { check, _size: () => windows.size };
}

export const memoryLimiter = createMemoryLimiter();

export type ChatLimiterInput = { sessionId: string; ipHash: string; db: Db | null };

export async function checkChatLimits(
  input: ChatLimiterInput,
  limiter = memoryLimiter,
  limits: { sessionPerHour: number; ipPerDay: number } = LIMITS,
): Promise<LimitResult> {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const s = limiter.check(`s:${input.sessionId}`, limits.sessionPerHour, hour);
  if (!s.ok) return { ok: false, reason: "session_hour", retry_after_s: s.retry_after_s };
  const i = limiter.check(`i:${input.ipHash}`, limits.ipPerDay, day);
  if (!i.ok) return { ok: false, reason: "ip_day", retry_after_s: i.retry_after_s };

  if (input.db) {
    try {
      const since = new Date(Date.now() - hour);
      const [bySession] = await input.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.chatMessages)
        .where(and(eq(schema.chatMessages.sessionId, input.sessionId), eq(schema.chatMessages.role, "user"), gte(schema.chatMessages.at, since)));
      if ((bySession?.n ?? 0) >= limits.sessionPerHour) return { ok: false, reason: "session_hour", retry_after_s: 3600 };
      const sinceDay = new Date(Date.now() - day);
      const [byIp] = await input.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.chatMessages)
        .innerJoin(schema.chatSessions, eq(schema.chatSessions.id, schema.chatMessages.sessionId))
        .where(and(eq(schema.chatSessions.ipHash, input.ipHash), eq(schema.chatMessages.role, "user"), gte(schema.chatMessages.at, sinceDay)));
      if ((byIp?.n ?? 0) >= limits.ipPerDay) return { ok: false, reason: "ip_day", retry_after_s: 6 * 3600 };
    } catch {
      // DB unreachable: the memory layer already applied; do not block chat on Neon.
    }
  }
  return { ok: true };
}
