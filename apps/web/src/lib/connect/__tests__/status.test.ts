/**
 * The status endpoint's job is to be believable, which means being willing to
 * say "nothing has arrived". Every case below is a case where a friendlier
 * screen would have shown a green tick it had not earned.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import { setConfig } from "@/lib/jobs/common";
import { mcpLimiter } from "@/lib/mcp/ratelimit";
import type { Provenance } from "@/lib/provenance";
import { connectStatus, type Signal, type SignalKey } from "../status";
import { mintConnectToken } from "../token";
import { connectTestDb, seedConnectEntity } from "./helpers";

const NOW = new Date("2026-09-06T12:00:00Z");
const entity = { id: "entity/boulder-creek", slug: "boulder-creek" };

const UNKNOWN: Provenance = { placement: null, provider: null, model: null, at: null, source: "unknown", stale: false, staleness_s: null, guard: null, reasoning_effort: null };

let db: TestDb;

const deps = (over: Partial<Parameters<typeof connectStatus>[2]> = {}) => ({
  now: NOW,
  provenance: async () => UNKNOWN,
  gatewayIsFake: () => true,
  gatewayIsConfigured: () => true,
  ...over,
});

function find(signals: Signal[], key: SignalKey): Signal {
  return signals.find((s) => s.key === key)!;
}

beforeEach(async () => {
  db = await connectTestDb();
  await seedConnectEntity(db, "boulder-creek");
});
afterEach(async () => {
  await closeTestDb(db);
});

describe("connect · the status signals", () => {
  it("says 'not set up' for everything that depends on a token before one exists", async () => {
    const status = await connectStatus(db, entity, deps());
    expect(find(status.signals, "token").state).toBe("not_configured");
    expect(find(status.signals, "mcp_call").state).toBe("not_configured");
    expect(find(status.signals, "mcp_tool").state).toBe("not_configured");
    for (const s of status.signals) expect(s.at === null || typeof s.at === "string").toBe(true);
    // nothing invented a time
    expect(find(status.signals, "mcp_call").at).toBeNull();
    expect(find(status.signals, "mcp_call").age_s).toBeNull();
  });

  it("moves a minted-but-unused token to 'waiting', never to 'seen'", async () => {
    await mintConnectToken(db, entity, "u-maya", new Date("2026-09-06T11:00:00Z"));
    const status = await connectStatus(db, entity, deps());
    expect(find(status.signals, "token").state).toBe("seen");
    expect(find(status.signals, "token").at).toBe("2026-09-06T11:00:00.000Z");
    expect(find(status.signals, "mcp_call").state).toBe("waiting");
    expect(find(status.signals, "mcp_tool").state).toBe("waiting");
  });

  it("sees the first authenticated MCP request, because the rate limiter writes when it happened", async () => {
    await mintConnectToken(db, entity, "u-maya", new Date("2026-09-06T11:00:00Z"));
    // exactly what `handleMcpRequest` does after verifying a token
    await mcpLimiter.check(db, "boulder-creek");
    const status = await connectStatus(db, entity, deps());
    const call = find(status.signals, "mcp_call");
    expect(call.state).toBe("seen");
    expect(call.at).not.toBeNull();
    // and still nothing about which tool, because the read path records none
    expect(find(status.signals, "mcp_tool").state).toBe("waiting");
  });

  it("names the tool behind a write, from the audit log the write leaves", async () => {
    await mintConnectToken(db, entity, "u-maya", new Date("2026-09-06T11:00:00Z"));
    await db.insert(schema.entityEvents).values({
      entityId: entity.id,
      at: new Date("2026-09-06T11:30:00Z"),
      actor: "mcp:boulder-creek",
      kind: "pulse.posted",
      payload: {},
      hash: "h".repeat(64),
    });
    const status = await connectStatus(db, entity, deps());
    const tool = find(status.signals, "mcp_tool");
    expect(tool.state).toBe("seen");
    expect(tool.detail).toBe("post_update");
    expect(tool.age_s).toBe(1800);
  });

  it("reports a pulse, and whether it spoke or looked and stayed quiet", async () => {
    await db.insert(schema.pulses).values({ entityId: entity.id, at: new Date("2026-09-06T11:00:00Z"), woke: true, text: null });
    const quiet = await connectStatus(db, entity, deps());
    expect(find(quiet.signals, "pulse").state).toBe("seen");
    expect(find(quiet.signals, "pulse").detail).toBe("silent");

    await db.insert(schema.pulses).values({ entityId: entity.id, at: new Date("2026-09-06T11:45:00Z"), woke: true, text: "Flow is 15.4 cfs." });
    const spoke = await connectStatus(db, entity, deps());
    expect(find(spoke.signals, "pulse").detail).toBe("spoke");
  });

  it("keeps the gate's provenance separate from the agent: unknown is not configured, a profile is only waiting", async () => {
    const unknown = await connectStatus(db, entity, deps());
    expect(find(unknown.signals, "gate").state).toBe("not_configured");

    const fromProfile = await connectStatus(db, entity, deps({ provenance: async () => ({ ...UNKNOWN, source: "profile", model: "qwen3.5-9b" }) }));
    expect(find(fromProfile.signals, "gate").state).toBe("waiting");

    const fromGate = await connectStatus(db, entity, deps({ provenance: async () => ({ ...UNKNOWN, source: "gate", placement: "hosted", provider: "OpenAI", at: "2026-09-06T11:00:00Z" }) }));
    expect(find(fromGate.signals, "gate").state).toBe("seen");
    expect(find(fromGate.signals, "gate").detail).toBe("OpenAI");
  });

  it("calls a fake chat gateway 'not set up', and a real one with no heartbeat 'waiting'", async () => {
    expect(find((await connectStatus(db, entity, deps())).signals, "chat").state).toBe("not_configured");

    const real = deps({ gatewayIsFake: () => false });
    expect(find((await connectStatus(db, entity, real)).signals, "chat").state).toBe("waiting");

    await setConfig(db, "gpu_last_seen_at", "2026-09-06T11:59:00Z");
    const seen = find((await connectStatus(db, entity, real)).signals, "chat");
    expect(seen.state).toBe("seen");
    expect(seen.age_s).toBe(60);
  });

  it("does not claim an empty gateway is configured, even with an old heartbeat", async () => {
    await setConfig(db, "gpu_last_seen_at", "2026-09-06T11:59:00Z");
    const status = await connectStatus(db, entity, deps({ gatewayIsFake: () => false, gatewayIsConfigured: () => false }));
    expect(find(status.signals, "chat").state).toBe("not_configured");
    expect(find(status.signals, "chat").at).toBeNull();
  });

  it("never reports a state outside the three it is allowed to have", async () => {
    const status = await connectStatus(db, entity, deps());
    for (const s of status.signals) expect(["not_configured", "waiting", "seen"]).toContain(s.state);
    expect(status.signals.map((s) => s.key)).toEqual(["token", "mcp_call", "mcp_tool", "pulse", "gate", "chat"]);
  });
});
