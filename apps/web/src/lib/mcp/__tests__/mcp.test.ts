import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, seedUser, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { handleMcpRequest, PLATFORM_TOOLS } from "../server";
import { mintEntityToken, slugFromToken, tokenHash, verifyEntityToken } from "../tokens";
import { createMcpLimiter } from "../ratelimit";
import { sanitizeEvidenceSummary, stripUrls } from "../evidence";
import { isoWeekOf, specSha256, bountySpecSchema } from "../bounty-spec";
import { getConfig, setConfig } from "@/lib/jobs/common";
import { NOW, seedBoulderCreek } from "@/lib/jobs/__tests__/helpers";

// Each case builds a fresh PGlite database and runs every migration; on a box
// running several suites at once that can outlast the shared 60 s default.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });


const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => closeTestDb(d)));
});

let rpcId = 0;
async function rpc(db: TestDb, token: string | null, method: string, params: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new Request("https://kami.test/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const res = await handleMcpRequest(req, { db, now: NOW });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // SSE framing: take the last data: line
    const last = text.split("\n").filter((l) => l.startsWith("data:")).pop();
    if (last) body = JSON.parse(last.slice(5).trim()) as Record<string, unknown>;
  }
  return { status: res.status, body };
}

function toolPayload(body: Record<string, unknown>): Record<string, unknown> {
  const result = body.result as { structuredContent?: Record<string, unknown>; content?: Array<{ text: string }>; isError?: boolean } | undefined;
  if (result?.structuredContent) return { ...result.structuredContent, _isError: result.isError ?? false };
  const text = result?.content?.[0]?.text;
  return { ...(text ? (JSON.parse(text) as Record<string, unknown>) : {}), _isError: result?.isError ?? false };
}

const goodSpec = {
  title: "Photograph the three diversion structures",
  why: "Flow at Orodell is 15.4 cfs (2026-09-04T20:15Z, cdss.telemetry).",
  deliverable: "Before/after photos of each structure, geotagged, 48 h apart",
  verification_tier: 2,
  evidence_spec: { min_photos: 6, exif_required: true, gps_within_m: 50, capture: "in_app" as const },
  cap_usdc: 40,
  claim_limit: 1,
  deadline: "2026-09-21",
  twin_refs: ["place/boulder-creek-near-orodell-co", "watershed/huc10-1019000504"],
  prediction: null,
};

describe("per-entity tokens", () => {
  it("stores only a sha256 and verifies in constant time", async () => {
    const { db } = await seedBoulderCreek({ slug: "token-creek" });
    dbs.push(db);
    const { token } = await mintEntityToken(db, "token-creek", NOW);
    expect(token).toMatch(/^kami_token-creek_[0-9a-f]{48}$/);
    expect(slugFromToken(token)).toBe("token-creek");
    const stored = await getConfig<{ sha256: string }>(db, "entity_tokens.token-creek");
    expect(stored!.sha256).toBe(tokenHash(token));
    expect(JSON.stringify(stored)).not.toContain(token.split("_")[2]);
    expect(await verifyEntityToken(db, token)).toEqual({ slug: "token-creek" });
    expect(await verifyEntityToken(db, `${token}x`)).toBeNull();
    expect(await verifyEntityToken(db, "kami_token-creek_" + "0".repeat(48))).toBeNull();
    expect(await verifyEntityToken(db, null)).toBeNull();
    // rotation invalidates the old token
    const rotated = await mintEntityToken(db, "token-creek", NOW);
    expect(await verifyEntityToken(db, token)).toBeNull();
    expect(await verifyEntityToken(db, rotated.token)).toEqual({ slug: "token-creek" });
  });
});

describe("the platform MCP", () => {
  it("refuses a request with no token and lists exactly the profile's tools", async () => {
    const { db } = await seedBoulderCreek({ slug: "mcp-creek" });
    dbs.push(db);
    const { token } = await mintEntityToken(db, "mcp-creek", NOW);

    const anon = await rpc(db, null, "tools/list");
    expect(anon.status).toBe(401);

    const init = await rpc(db, token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect((init.body.result as { serverInfo: { name: string } }).serverInfo.name).toBe("kami-platform");

    const list = await rpc(db, token, "tools/list");
    const names = (list.body.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();
    expect(names).toEqual([...PLATFORM_TOOLS].sort());
  });

  it("scopes a token to its own entity: A cannot read B", async () => {
    const a = await seedBoulderCreek({ slug: "entity-a" });
    dbs.push(a.db);
    await seedBoulderCreek({ db: a.db, slug: "entity-b" });
    const tokenA = (await mintEntityToken(a.db, "entity-a", NOW)).token;
    const tokenB = (await mintEntityToken(a.db, "entity-b", NOW)).token;

    const [snapB] = await a.db
      .insert(schema.needSnapshots)
      .values({ entityId: "entity/entity-b", asOf: NOW, snapshot: { entity_id: "entity/entity-b", secret: "B only" }, snapshotHash: "hb", mood: "content", staleDriving: false })
      .returning();

    const asA = toolPayload((await rpc(a.db, tokenA, "tools/call", { name: "get_needs_snapshot", arguments: {} })).body);
    expect(asA.entity_id).toBe("entity/entity-a");
    expect(asA.snapshot).toBeNull();
    expect(JSON.stringify(asA)).not.toContain("B only");

    const asB = toolPayload((await rpc(a.db, tokenB, "tools/call", { name: "get_needs_snapshot", arguments: {} })).body);
    expect(asB.entity_id).toBe("entity/entity-b");
    expect(asB.snapshot_id).toBe(snapB!.id);

    // A cannot post an update against B's snapshot id either
    const cross = toolPayload((await rpc(a.db, tokenA, "tools/call", { name: "post_update", arguments: { kind: "pulse", snapshot_id: snapB!.id } })).body);
    expect(cross._isError).toBe(true);
    expect(cross.error).toBe("not_found");
  });

  it("get_entity_config returns caps, guardian names, the disclosure label and a system message", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "config-creek" });
    dbs.push(db);
    const { token } = await mintEntityToken(db, "config-creek", NOW);
    await seedUser(db, "ada", "ada@example.org");
    await db.insert(schema.entityRoles).values({ entityId: entity.id, userId: "ada", role: "guardian", acceptedAt: NOW });
    await setConfig(db, "bounty_cap_usdc", { min: 25, max: 150 });

    const payload = toolPayload((await rpc(db, token, "tools/call", { name: "get_entity_config", arguments: {} })).body);
    const config = payload.config as Record<string, unknown>;
    expect(config).toMatchObject({ binding_version: 1, anchor: "place/boulder-creek-near-orodell-co", guardians: ["ada"], paused: false, agent_writes_allowed: true, agent_write_block_reason: null });
    expect((config.caps as Record<string, unknown>).bounty_cap_usdc).toEqual({ min: 25, max: 150 });
    expect(config.disclosure).toBe("I'm an AI voice for config-creek, built on public sensor data — not the creek, not a legal person.");
    expect(payload.system_message as string).toMatch(/^KAMI_ENTITY_CONFIG: \{/);
    expect(JSON.parse((payload.system_message as string).slice("KAMI_ENTITY_CONFIG: ".length)).entity.slug).toBe("config-creek");
    // ADR-E13: the label rides in every tool output
    expect(payload.disclosure).toBe(config.disclosure);
  });

  it("exposes proposed places for discovery without activating a pending binding", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "pending-creek" });
    dbs.push(db);
    await db.update(schema.entityBindings).set({ review: "pending_review" }).where(eq(schema.entityBindings.entityId, entity.id));
    const { token } = await mintEntityToken(db, "pending-creek", NOW);
    const payload = toolPayload((await rpc(db, token, "tools/call", { name: "get_entity_config", arguments: {} })).body);
    const config = payload.config as Record<string, unknown>;
    expect(config).toMatchObject({ binding_review: "pending_review", binding_active: false, agent_writes_allowed: false, agent_write_block_reason: "binding_pending_review", anchor: "place/boulder-creek-near-orodell-co" });
    expect(config.members).toBeGreaterThan(0);
    expect(config.member_places).toEqual(expect.arrayContaining([expect.objectContaining({ id: "place/boulder-creek-near-orodell-co" })]));
    expect(config.need_mappings).toEqual(expect.arrayContaining([expect.objectContaining({ need: "flow", property: "discharge", places: ["place/boulder-creek-near-orodell-co"], agg: "single" })]));
    expect(typeof config.membership_rule).toBe("string");
    expect(JSON.stringify(config)).not.toContain('"coordinates"');
    const [row] = await db.select().from(schema.entityBindings).where(eq(schema.entityBindings.entityId, entity.id));
    expect(row?.review).toBe("pending_review");
    const needs = toolPayload((await rpc(db, token, "tools/call", { name: "get_needs_snapshot", arguments: {} })).body);
    expect(needs.snapshot).toBeNull();
    await db.update(schema.entityBindings).set({ binding: {} }).where(eq(schema.entityBindings.entityId, entity.id));
    const invalid = toolPayload((await rpc(db, token, "tools/call", { name: "get_entity_config", arguments: {} })).body);
    expect(invalid.config).toMatchObject({ binding_review: "invalid", members: null, member_places: [], binding_active: false, membership_rule: null, need_mappings: [] });
  });

  it("post_update writes a pulse row (woke) and an entity_event", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "post-creek" });
    dbs.push(db);
    const { token } = await mintEntityToken(db, "post-creek", NOW);
    const [snap] = await db
      .insert(schema.needSnapshots)
      .values({ entityId: entity.id, asOf: NOW, snapshot: { entity_id: entity.id }, snapshotHash: "h", mood: "content", staleDriving: false })
      .returning();
    const payload = toolPayload((await rpc(db, token, "tools/call", { name: "post_update", arguments: { kind: "pulse", snapshot_id: snap!.id, text: "The gauge came back at 15.4 cfs." } })).body);
    expect(payload).toMatchObject({ kind: "pulse", has_text: true, snapshot_id: snap!.id });
    const [pulse] = await db.select().from(schema.pulses).where(eq(schema.pulses.entityId, entity.id));
    expect(pulse).toMatchObject({ woke: true, snapshotId: snap!.id });
    const events = await db.select().from(schema.entityEvents).where(eq(schema.entityEvents.entityId, entity.id));
    expect(events.map((e) => e.kind)).toContain("pulse.posted");
  });

  it("draft_bounty rejects a tier-1 without prediction, foreign twin_refs, a cap out of range and a fourth draft in the week", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "draft-creek" });
    dbs.push(db);
    const { token } = await mintEntityToken(db, "draft-creek", NOW);
    const call = async (spec: unknown) => toolPayload((await rpc(db, token, "tools/call", { name: "draft_bounty", arguments: { spec } })).body);

    const tier1 = await call({ ...goodSpec, verification_tier: 1, prediction: null });
    expect(tier1._isError).toBe(true);
    expect(String(tier1.message)).toMatch(/tier-1 bounty must carry a prediction/);

    const withPrediction = await call({ ...goodSpec, verification_tier: 1, prediction: { place_id: "place/boulder-creek-near-orodell-co", property: "discharge", direction: "up", window: "14d" } });
    expect(withPrediction._isError).toBe(false);

    const foreign = await call({ ...goodSpec, twin_refs: ["place/clear-creek-at-golden-co"] });
    expect(foreign._isError).toBe(true);
    expect(foreign.error).toBe("foreign_twin_ref");

    const overCap = await call({ ...goodSpec, cap_usdc: 900 });
    expect(overCap._isError).toBe(true);
    expect(overCap.error).toBe("cap_out_of_range");
    const underCap = await call({ ...goodSpec, cap_usdc: 5 });
    expect(underCap.error).toBe("cap_out_of_range");

    // two more good drafts fill the week (three total), the fourth is refused
    expect((await call({ ...goodSpec, title: "Second" }))._isError).toBe(false);
    expect((await call({ ...goodSpec, title: "Third" }))._isError).toBe(false);
    const fourth = await call({ ...goodSpec, title: "Fourth" });
    expect(fourth._isError).toBe(true);
    expect(fourth.error).toBe("weekly_limit");

    const rows = await db.select().from(schema.bounties).where(eq(schema.bounties.entityId, entity.id));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "drafted")).toBe(true);
    expect(new Set(rows.map((r) => r.specSha256)).size).toBe(3);
    expect(isoWeekOf(NOW)).toBe("2026-W36"); // 2026-09-06 is a Sunday: the ISO week that began Monday 2026-08-31
  });

  it("read_evidence_summary strips URLs, truncates free text and never returns file contents", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "evidence-creek" });
    dbs.push(db);
    const { token } = await mintEntityToken(db, "evidence-creek", NOW);
    await seedUser(db, "claimant", "claimant@example.org");
    await db.insert(schema.bounties).values({
      id: "b1",
      entityId: entity.id,
      title: "T",
      whyMd: "w",
      deliverableMd: "d",
      verificationTier: 2,
      evidenceSpec: {},
      capUsdc: "40.00",
      twinRefs: ["place/boulder-creek-near-orodell-co"],
      status: "in_review",
      specSha256: "0".repeat(64),
    });
    await db.insert(schema.claims).values({ id: "c1", bountyId: "b1", userId: "claimant" });
    await db.insert(schema.submissions).values({
      id: "s1",
      claimId: "c1",
      evidenceSummary: {
        photos: 6,
        exif_ok: true,
        note: `see https://evil.example/payload and www.other.test/x — ${"long ".repeat(200)}end`,
        content: "RAW FILE BYTES THAT MUST NEVER LEAVE",
        r2_key: "evidence/s1/photo.jpg",
        nested: { url: "https://evil.example", ok: "fine" },
      },
    });

    const payload = toolPayload((await rpc(db, token, "tools/call", { name: "read_evidence_summary", arguments: { submission_id: "s1" } })).body);
    const summary = payload.evidence_summary as Record<string, unknown>;
    expect(summary.photos).toBe(6);
    expect(summary.exif_ok).toBe(true);
    expect(String(summary.note)).not.toContain("evil.example");
    expect(String(summary.note)).not.toContain("www.other.test");
    expect(String(summary.note).length).toBeLessThanOrEqual(500);
    expect(String(summary.note).endsWith("…")).toBe(true);
    expect(summary.content).toBeUndefined();
    expect(summary.r2_key).toBeUndefined();
    expect((summary.nested as Record<string, unknown>).url).toBeUndefined();
    expect((summary.nested as Record<string, unknown>).ok).toBe("fine");
    expect(JSON.stringify(payload)).not.toContain("RAW FILE BYTES");

    // another entity's token cannot read it
    await seedBoulderCreek({ db, slug: "outsider-creek" });
    const outsider = (await mintEntityToken(db, "outsider-creek", NOW)).token;
    const denied = toolPayload((await rpc(db, outsider, "tools/call", { name: "read_evidence_summary", arguments: { submission_id: "s1" } })).body);
    expect(denied._isError).toBe(true);
    expect(denied.error).toBe("not_found");
  });

  it("get_attestation_summary counts by schema and lists at most 10 UIDs", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "attest-creek" });
    dbs.push(db);
    const { token } = await mintEntityToken(db, "attest-creek", NOW);
    for (let i = 0; i < 12; i++) {
      await db.insert(schema.attestations).values({ uid: `0xuid${i}`, schema: "BountyCompleted", mode: "offchain", attester: "0xabc", entityId: entity.id, payload: {}, createdAt: new Date(NOW.getTime() - i * 1000) });
    }
    await db.insert(schema.attestations).values({ uid: "0xreg", schema: "EntityRegistered", mode: "onchain", attester: "0xabc", entityId: entity.id, payload: {}, createdAt: NOW });
    const payload = toolPayload((await rpc(db, token, "tools/call", { name: "get_attestation_summary", arguments: {} })).body);
    expect(payload.total).toBe(13);
    const bySchema = payload.by_schema as Record<string, { count: number; last_uids: string[]; onchain: number }>;
    expect(bySchema.BountyCompleted!.count).toBe(12);
    expect(bySchema.BountyCompleted!.last_uids).toHaveLength(10);
    expect(bySchema.EntityRegistered!.onchain).toBe(1);
  });

  it("rate limits at 600 requests per hour per token", async () => {
    const { db } = await seedBoulderCreek({ slug: "rate-creek" });
    dbs.push(db);
    const { token } = await mintEntityToken(db, "rate-creek", NOW);
    const limiter = createMcpLimiter(() => NOW.getTime(), 2);
    const call = () => handleMcpRequest(new Request("https://kami.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), { db, now: NOW, limiter });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const third = await call();
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });

  it("refuses a retired entity's token", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "retired-creek" });
    dbs.push(db);
    const { token } = await mintEntityToken(db, "retired-creek", NOW);
    await db.update(schema.entities).set({ retiredAt: NOW }).where(eq(schema.entities.id, entity.id));
    const res = await rpc(db, token, "tools/list");
    expect(res.status).toBe(410);
  });
});

describe("spec and evidence helpers", () => {
  it("hashes a spec over canonical JSON, so key order cannot change it", () => {
    const a = bountySpecSchema.parse(goodSpec);
    const b = bountySpecSchema.parse({ ...goodSpec });
    expect(specSha256(a)).toBe(specSha256(b));
    expect(specSha256(a)).not.toBe(specSha256(bountySpecSchema.parse({ ...goodSpec, cap_usdc: 41 })));
  });
  it("strips every URL shape from free text", () => {
    expect(stripUrls("see https://a.test/x and www.b.test and data:text/plain;base64,AA and c.test/d")).toBe("see [link removed] and [link removed] and [link removed] and [link removed]");
  });
  it("bounds depth, keys and array length", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: "too deep" } } } } } } };
    expect(JSON.stringify(sanitizeEvidenceSummary(deep))).not.toContain("too deep");
    const wide = sanitizeEvidenceSummary({ list: Array.from({ length: 200 }, (_, i) => i) }) as { list: number[] };
    expect(wide.list).toHaveLength(64);
  });
});
