/**
 * Data retention (architecture §11; plan X.7), nightly:
 *
 *   chat_messages older than 90 days are deleted unless the session opted
 *   in to contribute (`chat_sessions.contribute_opt_in`); sessions left with
 *   no messages and no opt-in go too (they carry an IP hash).
 *
 *   usage_events older than 90 days are aggregated into daily rows —
 *   `config.usage_daily.<slug>` = { "<YYYY-MM-DD>|<job>": {n, tokens_prompt,
 *   tokens_output, latency_ms_sum} } — and the raw rows deleted.
 */
import { and, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { getConfig, setConfig } from "./jobs/common";

export const RETENTION_DAYS = 90;

export type RetentionReport = {
  cutoff: string;
  chat_messages_deleted: number;
  chat_sessions_deleted: number;
  chat_messages_kept_opt_in: number;
  usage_events_aggregated: number;
  usage_daily_buckets: number;
};

type DailyBucket = { n: number; tokens_prompt: number; tokens_output: number; latency_ms_sum: number };

export async function runRetention(db: DbOrTx, now = new Date(), days = RETENTION_DAYS): Promise<RetentionReport> {
  const cutoff = new Date(now.getTime() - days * 86400_000);

  const optInSessions = db.select({ id: schema.chatSessions.id }).from(schema.chatSessions).where(eq(schema.chatSessions.contributeOptIn, true));

  const deletedMessages = await db
    .delete(schema.chatMessages)
    .where(and(lt(schema.chatMessages.at, cutoff), or(isNull(schema.chatMessages.sessionId), notInArray(schema.chatMessages.sessionId, optInSessions))))
    .returning({ id: schema.chatMessages.id });

  const [kept] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.chatMessages)
    .innerJoin(schema.chatSessions, eq(schema.chatSessions.id, schema.chatMessages.sessionId))
    .where(and(lt(schema.chatMessages.at, cutoff), eq(schema.chatSessions.contributeOptIn, true)));

  const withMessages = db.select({ id: schema.chatMessages.sessionId }).from(schema.chatMessages).where(sql`${schema.chatMessages.sessionId} is not null`);
  const deletedSessions = await db
    .delete(schema.chatSessions)
    .where(and(lt(schema.chatSessions.startedAt, cutoff), eq(schema.chatSessions.contributeOptIn, false), notInArray(schema.chatSessions.id, withMessages)))
    .returning({ id: schema.chatSessions.id });

  // usage_events → daily buckets per entity
  const old = await db
    .select({
      id: schema.usageEvents.id,
      entityId: schema.usageEvents.entityId,
      at: schema.usageEvents.at,
      job: schema.usageEvents.job,
      p: schema.usageEvents.tokensPrompt,
      o: schema.usageEvents.tokensOutput,
      l: schema.usageEvents.latencyMs,
    })
    .from(schema.usageEvents)
    .where(lt(schema.usageEvents.at, cutoff));

  const slugs = new Map<string, string>();
  for (const e of await db.select({ id: schema.entities.id, slug: schema.entities.slug }).from(schema.entities)) slugs.set(e.id, e.slug);

  const perEntity = new Map<string, Record<string, DailyBucket>>();
  for (const r of old) {
    const slug = r.entityId ? (slugs.get(r.entityId) ?? "unknown") : "none";
    const day = (r.at ?? cutoff).toISOString().slice(0, 10);
    const key = `${day}|${r.job}`;
    const buckets = perEntity.get(slug) ?? {};
    const b = (buckets[key] ??= { n: 0, tokens_prompt: 0, tokens_output: 0, latency_ms_sum: 0 });
    b.n += 1;
    b.tokens_prompt += r.p;
    b.tokens_output += r.o;
    b.latency_ms_sum += r.l ?? 0;
    perEntity.set(slug, buckets);
  }
  let bucketCount = 0;
  for (const [slug, buckets] of perEntity) {
    const key = `usage_daily.${slug}`;
    const existing = (await getConfig<Record<string, DailyBucket>>(db, key)) ?? {};
    for (const [k, b] of Object.entries(buckets)) {
      const cur = existing[k] ?? { n: 0, tokens_prompt: 0, tokens_output: 0, latency_ms_sum: 0 };
      existing[k] = { n: cur.n + b.n, tokens_prompt: cur.tokens_prompt + b.tokens_prompt, tokens_output: cur.tokens_output + b.tokens_output, latency_ms_sum: cur.latency_ms_sum + b.latency_ms_sum };
      bucketCount++;
    }
    await setConfig(db, key, existing, now);
  }
  if (old.length) {
    const ids = old.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 1000) await db.delete(schema.usageEvents).where(inArray(schema.usageEvents.id, ids.slice(i, i + 1000)));
  }

  return {
    cutoff: cutoff.toISOString(),
    chat_messages_deleted: deletedMessages.length,
    chat_sessions_deleted: deletedSessions.length,
    chat_messages_kept_opt_in: kept?.n ?? 0,
    usage_events_aggregated: old.length,
    usage_daily_buckets: bucketCount,
  };
}
