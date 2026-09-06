import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, seedEntity, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { getConfig } from "../jobs/common";
import { runRetention, RETENTION_DAYS } from "../retention";

const NOW = new Date("2026-09-06T06:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86400_000);

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => closeTestDb(d)));
});

describe("retention (architecture §11, plan X.7)", () => {
  it("deletes chat messages older than 90 days only for sessions that did not opt in", async () => {
    const db = await createTestDb();
    dbs.push(db);
    const entity = await seedEntity(db, { slug: "retention-creek" });
    await db.insert(schema.chatSessions).values([
      { id: "s-old-out", entityId: entity.id, startedAt: days(120), contributeOptIn: false, ipHash: "ip1" },
      { id: "s-old-in", entityId: entity.id, startedAt: days(120), contributeOptIn: true, ipHash: "ip2" },
      { id: "s-new", entityId: entity.id, startedAt: days(2), contributeOptIn: false, ipHash: "ip3" },
    ]);
    await db.insert(schema.chatMessages).values([
      { sessionId: "s-old-out", at: days(120), role: "user", content: "old, opted out" },
      { sessionId: "s-old-out", at: days(91), role: "assistant", content: "old reply" },
      { sessionId: "s-old-out", at: days(3), role: "user", content: "recent, opted out" },
      { sessionId: "s-old-in", at: days(120), role: "user", content: "old, opted in" },
      { sessionId: "s-new", at: days(2), role: "user", content: "recent" },
    ]);

    const report = await runRetention(db, NOW);
    expect(report.chat_messages_deleted).toBe(2);
    expect(report.chat_messages_kept_opt_in).toBe(1);
    expect(new Date(report.cutoff).toISOString()).toBe(days(RETENTION_DAYS).toISOString());

    const left = await db.select().from(schema.chatMessages);
    expect(left.map((m) => m.content).sort()).toEqual(["old, opted in", "recent", "recent, opted out"]);
    // the opted-out old session kept a recent message, so its row stays
    expect((await db.select().from(schema.chatSessions)).map((s) => s.id).sort()).toEqual(["s-new", "s-old-in", "s-old-out"]);

    // a second run is a no-op
    const again = await runRetention(db, NOW);
    expect(again.chat_messages_deleted).toBe(0);
  });

  it("deletes an old opted-out session that has no messages left", async () => {
    const db = await createTestDb();
    dbs.push(db);
    const entity = await seedEntity(db, { slug: "empty-session-creek" });
    await db.insert(schema.chatSessions).values([
      { id: "s-empty-old", entityId: entity.id, startedAt: days(200), contributeOptIn: false, ipHash: "ip" },
      { id: "s-empty-old-in", entityId: entity.id, startedAt: days(200), contributeOptIn: true, ipHash: "ip" },
    ]);
    const report = await runRetention(db, NOW);
    expect(report.chat_sessions_deleted).toBe(1);
    expect((await db.select().from(schema.chatSessions)).map((s) => s.id)).toEqual(["s-empty-old-in"]);
  });

  it("aggregates usage events older than 90 days into daily config rows and deletes the raw rows", async () => {
    const db = await createTestDb();
    dbs.push(db);
    const entity = await seedEntity(db, { slug: "usage-creek" });
    await db.insert(schema.usageEvents).values([
      { entityId: entity.id, at: days(100), job: "chat", tokensPrompt: 100, tokensOutput: 40, latencyMs: 500 },
      { entityId: entity.id, at: days(100), job: "chat", tokensPrompt: 50, tokensOutput: 10, latencyMs: 300 },
      { entityId: entity.id, at: days(100), job: "pulse", tokensPrompt: 20, tokensOutput: 0, latencyMs: null },
      { entityId: entity.id, at: days(5), job: "chat", tokensPrompt: 7, tokensOutput: 3, latencyMs: 100 },
    ]);
    const report = await runRetention(db, NOW);
    expect(report.usage_events_aggregated).toBe(3);
    expect(report.usage_daily_buckets).toBe(2);

    const rows = await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.entityId, entity.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokensPrompt).toBe(7);

    const daily = await getConfig<Record<string, { n: number; tokens_prompt: number; tokens_output: number; latency_ms_sum: number }>>(db, "usage_daily.usage-creek");
    const day = days(100).toISOString().slice(0, 10);
    expect(daily![`${day}|chat`]).toEqual({ n: 2, tokens_prompt: 150, tokens_output: 50, latency_ms_sum: 800 });
    expect(daily![`${day}|pulse`]).toEqual({ n: 1, tokens_prompt: 20, tokens_output: 0, latency_ms_sum: 0 });
  });
});
