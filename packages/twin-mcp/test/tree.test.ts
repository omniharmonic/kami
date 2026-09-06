import { describe, expect, it } from "vitest";
import { TreeReader, ttlFor } from "../src/tree.js";
import { FIXTURE_STALE } from "./helpers.js";

function fakeTree(files: Record<string, { body: string; etag: string }>) {
  const log: { url: string; ifNoneMatch: string | null; ua: string | null }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    log.push({ url, ifNoneMatch: h.get("If-None-Match"), ua: h.get("User-Agent") });
    const path = url.replace("https://tree.test/", "");
    const f = files[path];
    if (!f) return new Response("nope", { status: 404 });
    if (h.get("If-None-Match") === f.etag) return new Response(null, { status: 304, headers: { etag: f.etag } });
    return new Response(f.body, { status: 200, headers: { etag: f.etag, "content-type": "application/json" } });
  };
  return { log, fetchImpl };
}

describe("TreeReader (remote)", () => {
  const cond = { body: '{"schema_version":"1.0","generated_at":"2026-09-06T05:00:00Z","stations":[]}', etag: '"c1"' };
  const idx = { body: '{"schema_version":"1.0","generated_at":"2026-09-06T04:00:00Z","count":0,"places":[]}', etag: '"i1"' };

  it("sends the User-Agent with a contact and If-None-Match on revalidation; 304 keeps the body", async () => {
    let t = 0;
    const { log, fetchImpl } = fakeTree({ "latest/conditions.json": cond });
    const r = new TreeReader({ tree: "https://tree.test/", fetch: fetchImpl, now: () => t, contact: "ops@example.org" });
    const a = await r.getJson<{ generated_at: string }>("latest/conditions.json");
    expect(a?.generated_at).toBe("2026-09-06T05:00:00Z");
    expect(log[0]!.ua).toBe("bioregionaltwin-mcp/0.1.0 (ops@example.org)");
    expect(log[0]!.ifNoneMatch).toBeNull();
    t = 61_000; // past the 60 s TTL and floor
    const b = await r.getJson<{ generated_at: string }>("latest/conditions.json");
    expect(b?.generated_at).toBe("2026-09-06T05:00:00Z");
    expect(log.length).toBe(2);
    expect(log[1]!.ifNoneMatch).toBe('"c1"');
    expect(r.stats.notModified).toBe(1);
    expect(r.generatedAt("latest/conditions.json")).toBe("2026-09-06T05:00:00Z");
  });

  it("honours the 60 s floor per path even when asked every second", async () => {
    let t = 0;
    const { log, fetchImpl } = fakeTree({ "latest/conditions.json": cond });
    const r = new TreeReader({ tree: "https://tree.test", fetch: fetchImpl, now: () => t });
    for (let i = 0; i < 59; i++) {
      t = i * 1000;
      await r.getJson("latest/conditions.json");
    }
    expect(log.length).toBe(1);
    t = 60_000;
    await r.getJson("latest/conditions.json");
    expect(log.length).toBe(2);
  });

  it("uses 300 s for id/, geom/, boundary/ and 3600 s for network/", async () => {
    expect(ttlFor("latest/conditions.json")).toBe(60_000);
    expect(ttlFor("latest/place/x.json")).toBe(60_000);
    expect(ttlFor("id/index.json")).toBe(300_000);
    expect(ttlFor("geom/place/x.geojson")).toBe(300_000);
    expect(ttlFor("boundary/v1.md")).toBe(300_000);
    expect(ttlFor("network/reaches.geojson")).toBe(3_600_000);
    let t = 0;
    const { log, fetchImpl } = fakeTree({ "id/index.json": idx });
    const r = new TreeReader({ tree: "https://tree.test", fetch: fetchImpl, now: () => t });
    await r.getJson("id/index.json");
    t = 299_000;
    await r.getJson("id/index.json");
    expect(log.length).toBe(1);
    t = 301_000;
    await r.getJson("id/index.json");
    expect(log.length).toBe(2);
  });

  it("404 → null, cached like any other answer", async () => {
    const { log, fetchImpl } = fakeTree({});
    const r = new TreeReader({ tree: "https://tree.test", fetch: fetchImpl, now: () => 0 });
    expect(await r.getJson("briefings/latest.json")).toBeNull();
    expect(await r.getText("normals/place/x.json")).toBeNull();
    expect(await r.getJson("briefings/latest.json")).toBeNull();
    expect(log.length).toBe(2);
    expect(r.stats.notFound).toBe(2);
  });

  it("serves the cached body when the origin errors after a good fetch (stale-if-error) and throws when it never had one", async () => {
    let fail = false;
    let t = 0;
    const r = new TreeReader({
      tree: "https://tree.test",
      now: () => t,
      fetch: async () => (fail ? new Response("boom", { status: 503 }) : new Response(cond.body, { status: 200, headers: { etag: '"x"' } })),
    });
    await r.getJson("latest/conditions.json");
    fail = true;
    t = 120_000;
    expect(await r.getJson<{ generated_at: string }>("latest/conditions.json")).toMatchObject({ generated_at: "2026-09-06T05:00:00Z" });
    await expect(r.getJson("latest/health.json")).rejects.toThrow(/503/);
  });

  it("coalesces concurrent requests for one path", async () => {
    const { log, fetchImpl } = fakeTree({ "latest/conditions.json": cond });
    const r = new TreeReader({ tree: "https://tree.test", fetch: fetchImpl, now: () => 0 });
    await Promise.all([r.getJson("latest/conditions.json"), r.getJson("latest/conditions.json"), r.getJson("latest/conditions.json")]);
    expect(log.length).toBe(1);
  });
});

describe("TreeReader (local directory)", () => {
  it("reads files, honours the .headers.json sidecar, and returns null for a missing path", async () => {
    const r = new TreeReader({ tree: FIXTURE_STALE, now: () => 0 });
    const c = await r.getJson<{ generated_at: string; schema_version: string }>("latest/conditions.json");
    expect(c?.generated_at).toBe("2026-09-06T05:00:00Z");
    expect(r.schemaVersion("latest/conditions.json")).toBe("1.0");
    expect(r.etag("latest/conditions.json")).toMatch(/^"fx-/);
    expect(r.isRemote).toBe(false);
    expect(await r.getJson("network/reaches.geojson")).toBeNull();
    expect(await r.getText("boundary/v1.md")).toContain("rationale");
  });
});
