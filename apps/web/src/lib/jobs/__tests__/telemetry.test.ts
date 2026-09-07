import { describe, expect, it } from "vitest";
import { createTestDb, seedEntity } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { recordTelemetry, telemetrySchema, type Telemetry } from "../telemetry";

const sample = (id = "a".repeat(64)): Telemetry["records"][number] => ({ id, kind: "usage", slug: "boulder-creek", at: "2026-09-07T22:15:00Z", job: "chat", prompt_tokens: 123, output_tokens: 45, latency_ms: 120 });

describe("idempotent runtime telemetry", () => {
  it("retries acknowledge records without double counting measured usage", async () => {
    const db = await createTestDb(); await seedEntity(db, { slug: "boulder-creek" });
    const input: Telemetry = { version: 1, records: [sample()] };
    const first = await recordTelemetry(db, input);
    const second = await recordTelemetry(db, input);
    expect(first.inserted.usage).toBe(1);
    expect(second.inserted.usage).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(second.acknowledged).toEqual([sample().id]);
    const rows = await db.select().from(schema.usageEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokensPrompt).toBe(123);
  });
  it("rolls back all newly claimed IDs when another ID conflicts", async () => {
    const db = await createTestDb(); await seedEntity(db, { slug: "boulder-creek" });
    await recordTelemetry(db, { version: 1, records: [sample()] });
    await expect(recordTelemetry(db, { version: 1, records: [sample("b".repeat(64)), { ...sample(), job: "cron" }] })).rejects.toThrow("event_id_conflict");
    expect(await db.select().from(schema.usageEvents)).toHaveLength(1);
    const recovered = await recordTelemetry(db, { version: 1, records: [sample("b".repeat(64))] });
    expect(recovered.inserted.usage).toBe(1);
  });
  it("rejects unknown entity slugs without storing events", async () => {
    const db = await createTestDb();
    await expect(recordTelemetry(db, { version: 1, records: [sample()] })).rejects.toThrow("unknown_entity");
    expect(await db.select().from(schema.config)).toHaveLength(0);
  });
  it("stores guard categories without model sentences or arbitrary payloads", async () => {
    const db = await createTestDb(); await seedEntity(db, { slug: "boulder-creek" });
    const guard = { ...sample(), kind: "guard", action: "drop", reason: "unmatched" };
    const safe = telemetrySchema.parse({ version: 1, records: [{ id: guard.id, slug: guard.slug, at: guard.at, job: guard.job, kind: "guard", action: "drop", reason: "unmatched" }] });
    await recordTelemetry(db, safe);
    const rows = await db.select().from(schema.guardEvents);
    expect(rows[0]?.sentence).toBe("");
    expect(rows[0]?.action).toBe("drop");
    expect(telemetrySchema.safeParse({ version: 1, records: [{ ...safe.records[0], sentence: "private model content" }] }).success).toBe(false);
  });
  it("refuses unbounded counts and oversized batches", () => {
    for (const prompt_tokens of [-1, Number.POSITIVE_INFINITY, 2 ** 40, 1.5]) expect(telemetrySchema.safeParse({ version: 1, records: [{ ...sample(), prompt_tokens }] }).success).toBe(false);
    expect(telemetrySchema.safeParse({ version: 1, records: Array.from({ length: 251 }, () => sample()) }).success).toBe(false);
  });
});
