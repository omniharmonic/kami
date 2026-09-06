import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  TwinClient,
  TwinContractError,
  TwinUnreachable,
  readingStaleness,
  stationsForHuc12s,
  stationsForIds,
} from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const UA = "kami/0.1.0-test (synergy@benjaminlife.one)";

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** A fake origin: a map of path → {status, body, etag}; records every call. */
function fakeOrigin(routes: Record<string, { status?: number; body?: unknown; etag?: string; text?: string }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url, headers });
    const path = url.replace("https://twin.test/", "");
    const route = routes[path];
    if (!route) return new Response("not found", { status: 404 });
    if (route.status && route.status >= 500) return new Response("boom", { status: route.status });
    const inm = headers["If-None-Match"];
    if (route.etag && inm === route.etag) return new Response(null, { status: 304, headers: { etag: route.etag } });
    const body = route.text ?? JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200, headers: route.etag ? { etag: route.etag } : {} });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const conditionsBody = {
  schema_version: "1.0",
  generated_at: "2026-09-06T06:00:00Z",
  bbox: [-106.5, 38.5, -104.0, 41.0],
  sources: { "cdss.telemetry": { health: "ok", attribution: "DWR", tier: "A" } },
  stations: [
    {
      id: "place/boulder-creek-near-orodell-co",
      name: "BOULDER CREEK NEAR ORODELL, CO.",
      kind: "monitoring_site",
      huc12: "101900050404",
      readings: [{ property: "discharge", value: 15.4, unit: "[ft_i]3/s", time: "2026-09-04T20:15:00Z", source_id: "cdss.telemetry", staleness_s: 118000, stale: true }],
    },
    { id: "place/niwot", name: "Niwot", kind: "monitoring_site", huc12: "101900050401", readings: [{ property: "swe", value: 0, source_id: "nrcs.awdb", stale: true, staleness_s: 181358 }] },
  ],
};

function client(fetchImpl: typeof fetch, clock: { t: number }, minIntervalMs = 60_000) {
  return new TwinClient({ baseUrl: "https://twin.test", userAgent: UA, fetchImpl, now: () => clock.t, minIntervalMs });
}

describe("TwinClient over the network (fake fetch)", () => {
  it("sends the User-Agent on every request and validates the envelope", async () => {
    const { calls, fetchImpl } = fakeOrigin({ "latest/conditions.json": { body: conditionsBody, etag: '"c1"' }, "latest/health.json": { status: 404 } });
    const c = client(fetchImpl, { t: 0 });
    const res = await c.conditions();
    expect(res?.data.stations).toHaveLength(2);
    expect(res?.meta).toMatchObject({ path: "latest/conditions.json", etag: '"c1"', generated_at: "2026-09-06T06:00:00Z", from_cache: false });
    await c.health();
    await c.snow();
    expect(calls.length).toBe(3);
    for (const call of calls) expect(call.headers["User-Agent"]).toBe(UA);
  });

  it("ETag → If-None-Match → 304 serves the cached body", async () => {
    const { calls, fetchImpl } = fakeOrigin({ "latest/conditions.json": { body: conditionsBody, etag: '"c1"' } });
    const clock = { t: 0 };
    const c = client(fetchImpl, clock);
    const first = await c.conditions();
    clock.t = 61_000;
    const second = await c.conditions();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers["If-None-Match"]).toBe('"c1"');
    expect(second?.meta.from_cache).toBe(true);
    expect(second?.meta.etag).toBe('"c1"');
    expect(second?.data).toEqual(first?.data);
    expect(second?.meta.fetched_at).toBe(new Date(61_000).toISOString());
  });

  it("60 s floor: a second call inside the floor never touches the origin, even with force", async () => {
    const { calls, fetchImpl } = fakeOrigin({ "latest/conditions.json": { body: conditionsBody, etag: '"c1"' } });
    const clock = { t: 1_000 };
    const c = client(fetchImpl, clock);
    await c.conditions();
    clock.t = 30_000;
    const again = await c.conditions({ force: true });
    expect(calls).toHaveLength(1);
    expect(again?.meta.from_cache).toBe(true);
    clock.t = 61_000;
    await c.conditions({ force: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers["If-None-Match"]).toBeUndefined(); // force skips the conditional, not the floor
  });

  it("404 → null (and the null is cached under the floor too)", async () => {
    const { calls, fetchImpl } = fakeOrigin({});
    const c = client(fetchImpl, { t: 0 });
    expect(await c.placePage("place/nobody")).toBeNull();
    expect(await c.normals("place/boulder-creek-near-orodell-co")).toBeNull();
    expect(await c.briefing()).toBeNull();
    expect(await c.placePage("place/nobody")).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it("network error → TwinUnreachable carrying the last cached body", async () => {
    let fail = false;
    const { fetchImpl } = fakeOrigin({ "latest/conditions.json": { body: conditionsBody, etag: '"c1"' } });
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      if (fail) throw new TypeError("fetch failed");
      return fetchImpl(input, init);
    }) as typeof fetch;
    const clock = { t: 0 };
    const c = client(flaky, clock);
    await c.conditions();
    fail = true;
    clock.t = 120_000;
    const err = await c.conditions().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwinUnreachable);
    expect((err as TwinUnreachable).cached).toMatchObject({ schema_version: "1.0" });
    expect((err as TwinUnreachable).status).toBeNull();
  });

  it("5xx → TwinUnreachable with the status; no cache → cached null", async () => {
    const { fetchImpl } = fakeOrigin({ "latest/conditions.json": { status: 503 } });
    const c = client(fetchImpl, { t: 0 });
    const err = await c.conditions().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwinUnreachable);
    expect((err as TwinUnreachable).status).toBe(503);
    expect((err as TwinUnreachable).cached).toBeNull();
  });

  it("an envelope that breaks the contract throws TwinContractError, unknown keys pass", async () => {
    const { fetchImpl } = fakeOrigin({
      "latest/conditions.json": { body: { ...conditionsBody, some_new_key: 1, stations: "nope" } },
      "latest/snow.json": { body: { schema_version: "1.0", generated_at: "x", snowline_m: null, opacity: 0, basis: [], rule: "r", stale: false, extra: true } },
    });
    const c = client(fetchImpl, { t: 0 });
    await expect(c.conditions()).rejects.toBeInstanceOf(TwinContractError);
    const snow = await c.snow();
    expect(snow?.data.snowline_m).toBeNull();
    expect((snow?.data as unknown as Record<string, unknown>).extra).toBe(true);
  });

  it("rejects an id that is not a twin place id before building a path", async () => {
    const { calls, fetchImpl } = fakeOrigin({});
    const c = client(fetchImpl, { t: 0 });
    await expect(c.idRecord("../etc/passwd")).rejects.toBeInstanceOf(TypeError);
    await expect(c.placePage("Place/Bad")).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("boundaryRationale returns text", async () => {
    const { fetchImpl } = fakeOrigin({ "boundary/v1.md": { text: "# Ring A\n" } });
    const c = client(fetchImpl, { t: 0 });
    expect((await c.boundaryRationale())?.data).toBe("# Ring A\n");
  });

  it("an unknown-staleness reading from the wire is not fresh", async () => {
    const { fetchImpl } = fakeOrigin({
      "latest/place/x.json": { body: { schema_version: "1.0", generated_at: "2026-09-06T06:00:00Z", id: "place/x", kind: "monitoring_site", name: "X", readings: [{ property: "discharge", source_id: "cdss.telemetry", time: "2026-09-06T05:59:00Z" }], series: {} } },
    });
    const c = client(fetchImpl, { t: 0 });
    const page = await c.placePage("place/x");
    const s = readingStaleness(page!.data.readings[0]!, Date.parse("2026-09-06T06:00:00Z"));
    expect(s.unknown).toBe(true);
    expect(s.stale).toBe(false);
  });
});

describe("TwinClient in local-dir mode (fixture tree)", () => {
  const c = new TwinClient({ localDir: FIXTURES, userAgent: UA });

  it("reads id/index.json", async () => {
    const idx = await c.index();
    expect(idx?.data.count).toBe(idx?.data.places.length);
    expect(idx?.data.places.map((p) => p.id)).toContain("place/boulder-creek-near-orodell-co");
    expect(idx?.meta.etag).toMatch(/^"sha256-/);
    expect(idx?.meta.generated_at).toBe("2026-09-06T06:00:00Z");
  });

  it("reads id records and place pages; missing → null", async () => {
    const rec = await c.idRecord("place/boulder-creek-near-orodell-co");
    expect(rec?.data.sensitivity).toBe("public");
    expect(rec?.data.sameAs).toContain("https://dwr.state.co.us/Tools/Stations/BOCOROCO");
    const page = await c.placePage("place/niwot");
    expect(page?.data.readings.map((r) => r.property)).toContain("swe");
    expect(page?.data.readings[0]?.staleness_crit_s).toBe(86400);
    expect(page?.data.readings[0]?.stale).toBeUndefined(); // threshold dialect only
    expect(await c.placePage("place/does-not-exist")).toBeNull();
  });

  it("reads conditions and health; the station helpers filter", async () => {
    const cond = await c.conditions();
    const board = await c.health();
    expect(cond?.data.stations.length).toBeGreaterThanOrEqual(4);
    expect(board?.data.sources.find((s) => s.source_id === "cdss.telemetry")?.staleness_crit_s).toBe(10800);
    const byHuc = stationsForHuc12s(cond!.data, ["101900050404", "101900050401"]);
    expect(byHuc.map((s) => s.id).sort()).toEqual(["place/boulder-creek-near-orodell-co", "place/niwot"]);
    const byId = stationsForIds(cond!.data, ["place/gross-reservoir", "place/nope"]);
    expect(byId.map((s) => s.id)).toEqual(["place/gross-reservoir"]);
    expect(byId[0]?.readings.find((r) => r.property === "reservoir_fill")?.derived).toBe(true);
  });

  it("second read inside the floor comes from cache", async () => {
    const a = await c.conditions();
    const b = await c.conditions();
    expect(a?.meta.from_cache).toBe(true); // already read above
    expect(b?.meta.from_cache).toBe(true);
  });

  it("refuses to escape the tree", async () => {
    await expect(c.get("../package.json")).rejects.toBeInstanceOf(TypeError);
  });
});
