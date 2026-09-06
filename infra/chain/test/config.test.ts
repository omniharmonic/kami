import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HttpConfigStore, JsonFileConfigStore, MemoryConfigStore, writeIfChanged } from "../src/config.js";

describe("config stores", () => {
  it("JSON file store: a second identical run makes zero writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kami-chain-"));
    const store = new JsonFileConfigStore(join(dir, "config.84532.json"));
    expect(await writeIfChanged(store, "safe.x.address", "0xabc")).toBe(true);
    expect(await writeIfChanged(store, "eas.schema.A", "0x01")).toBe(true);
    expect(store.writes).toBe(2);
    expect(await writeIfChanged(store, "safe.x.address", "0xabc")).toBe(false);
    expect(await writeIfChanged(store, "eas.schema.A", "0x01")).toBe(false);
    expect(store.writes).toBe(2);
    const onDisk = JSON.parse(readFileSync(join(dir, "config.84532.json"), "utf8"));
    expect(Object.keys(onDisk)).toEqual(["eas.schema.A", "safe.x.address"]); // sorted, stable diffs
  });

  it("memory store counts writes", async () => {
    const m = new MemoryConfigStore({ a: 1 });
    expect(await writeIfChanged(m, "a", 1)).toBe(false);
    expect(await writeIfChanged(m, "a", 2)).toBe(true);
    expect(m.writes).toBe(1);
  });

  it("HTTP store GETs and POSTs /api/admin/config with a bearer token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (!init.method) return new Response(null, { status: 404 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const store = new HttpConfigStore("https://kami.example/", "tok", fakeFetch);
    expect(await store.get("safe.x.address")).toBeUndefined();
    await writeIfChanged(store, "safe.x.address", "0xabc");
    expect(calls[0]!.url).toBe("https://kami.example/api/admin/config?key=safe.x.address");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    // writeIfChanged reads first (404 again), then POSTs
    expect(calls).toHaveLength(3);
    expect(calls[2]!.init.method).toBe("POST");
    expect(JSON.parse(calls[2]!.init.body as string)).toEqual({ key: "safe.x.address", value: "0xabc" });
    expect(store.writes).toBe(1);
  });
});
