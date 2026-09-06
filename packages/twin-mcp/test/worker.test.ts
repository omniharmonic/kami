import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { ANON_PER_MIN, createWorkerHandler, TokenBuckets } from "../src/worker.js";
import { FIXTURE_STALE, NOW } from "./helpers.js";

/** A fake CDN in front of the fixture tree. */
const treeFetch = async (url: string) => {
  const path = url.replace("https://data.test/", "");
  try {
    return new Response(readFileSync(join(FIXTURE_STALE, path)), { status: 200, headers: { etag: `"${path.length}"`, "content-type": "application/json" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
};

function client(handler: ReturnType<typeof createWorkerHandler>, env: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.test/mcp"), {
    fetch: (input, init) => handler.fetch(new Request(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers as HeadersInit)), ...headers } }), { TREE_BASE_URL: "https://data.test", ...env }),
  });
  return { c: new Client({ name: "test", version: "0" }), transport };
}

describe("Worker (Streamable HTTP, stateless)", () => {
  it("answers initialize + tools/list with _meta.contract_version and list_entities → {entities: []}", async () => {
    const handler = createWorkerHandler({ fetch: treeFetch, now: () => NOW });
    const { c, transport } = client(handler);
    await c.connect(transport);
    const tools = await c.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("get_entity_status");
    expect((tools as { _meta?: Record<string, unknown> })._meta?.["contract_version"]).toBe("1.0");
    const res = await c.callTool({ name: "list_entities", arguments: {} });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    expect(JSON.parse(text)["entities"]).toEqual([]);
    const place = await c.callTool({ name: "get_place", arguments: { id: "place/gross-reservoir" } });
    const body = JSON.parse((place.content as { text: string }[])[0]!.text);
    expect(body["name"]).toBe("Gross Reservoir ");
    expect(JSON.stringify(body)).not.toContain('"coordinates"');
    await transport.close();
  });

  it("get_entity_status without a binding is a clean error, not a crash", async () => {
    const handler = createWorkerHandler({ fetch: treeFetch, now: () => NOW });
    const { c, transport } = client(handler);
    await c.connect(transport);
    const res = await c.callTool({ name: "get_entity_status", arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.parse((res.content as { text: string }[])[0]!.text).error.code).toBe("no_binding");
    await transport.close();
  });

  it("rate-limits anonymous callers at 60/min per IP and lets an API key through", async () => {
    let t = NOW;
    const handler = createWorkerHandler({ fetch: treeFetch, now: () => t });
    const env = { TREE_BASE_URL: "https://data.test", API_KEYS: "k1,k2" };
    const hit = (ip: string, key?: string) => handler.fetch(new Request("https://mcp.test/", { headers: { "CF-Connecting-IP": ip, ...(key ? { "X-API-Key": key } : {}) } }), env);
    for (let i = 0; i < ANON_PER_MIN; i++) expect((await hit("1.2.3.4")).status).toBe(200);
    const blocked = await hit("1.2.3.4");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await hit("5.6.7.8")).status).toBe(200); // another IP has its own bucket
    expect((await hit("1.2.3.4", "k1")).status).toBe(200); // keyed tier
    expect((await hit("1.2.3.4", "k1")).headers.get("x-ratelimit-tier")).toBe("keyed");
    t += 60_000; // a minute later the bucket has refilled
    expect((await hit("1.2.3.4")).status).toBe(200);
    expect((await handler.fetch(new Request("https://mcp.test/healthz"), env)).status).toBe(200);
  });

  it("token bucket refills linearly", () => {
    let t = 0;
    const b = new TokenBuckets(() => t);
    for (let i = 0; i < 60; i++) expect(b.take("x", 60)).toBe(true);
    expect(b.take("x", 60)).toBe(false);
    t = 1000; // one second → one token
    expect(b.take("x", 60)).toBe(true);
    expect(b.take("x", 60)).toBe(false);
  });
});
