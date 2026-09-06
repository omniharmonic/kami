import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CACHE_CONTROL, cacheControlFor, etagFor, assertKey } from "../publisher";
import { LocalDirPublisher, HEADERS_SUFFIX } from "../local";
import { R2Publisher, r2EnvFrom } from "../r2";
import { publishStatus, statusKey } from "../index";

const dirs: string[] = [];
async function tmpDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "kami-publish-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const snapshot = {
  schema_version: "1.0",
  entity_id: "entity/boulder-creek",
  as_of: "2026-09-06T06:00:00Z",
  needs: [],
  drought_class: null,
  alert_level: 0,
  flood_category: null,
  stale_driving: false,
  mood: "content",
  mood_reason: "my senses read normal",
  season: 2,
  gpu_online: true,
  paused: false,
  cosmetics: {},
};

const statusFile = {
  schema_version: "1.0",
  entity_id: "entity/boulder-creek",
  as_of: "2026-09-06T06:00:00Z",
  snapshot,
  pulses: [],
  board: { open: 0, claimed: 0, in_review: 0, paid: 0, human_proposals: 0 },
  treasury: { safe_address: null, balance_usdc: null, pending: 0 },
  event_chain_head: "abc",
};

describe("cache classes", () => {
  it("uses the twin's `latest` class verbatim (survey §1.3)", () => {
    expect(CACHE_CONTROL.latest).toBe("public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400");
    expect(CACHE_CONTROL.id).toBe("public, max-age=300");
    expect(cacheControlFor("latest")).toBe(CACHE_CONTROL.latest);
  });
  it("has no safe default for an unknown class", () => {
    expect(() => cacheControlFor("nope")).toThrow(/unknown cache class/);
  });
  it("refuses a key that climbs out of the tree", () => {
    expect(() => assertKey("../secrets")).toThrow();
    expect(() => assertKey("entity/x/../../y")).toThrow();
    expect(assertKey("/entity/x/status.json")).toBe("entity/x/status.json");
  });
});

describe("LocalDirPublisher", () => {
  it("writes the body and the twin's `.headers.json` sidecar", async () => {
    const dir = await tmpDir();
    const p = new LocalDirPublisher(dir);
    const { etag } = await p.put("entity/boulder-creek/status.json", '{"a":1}\n', { contentType: "application/json", cacheControl: CACHE_CONTROL.latest });
    const body = await fs.readFile(path.join(dir, "entity/boulder-creek/status.json"), "utf8");
    const headers = JSON.parse(await fs.readFile(path.join(dir, `entity/boulder-creek/status.json${HEADERS_SUFFIX}`), "utf8"));
    expect(body).toBe('{"a":1}\n');
    expect(headers).toEqual({ "Cache-Control": CACHE_CONTROL.latest, "Content-Type": "application/json", ETag: etag });
    expect(etag).toBe(etagFor('{"a":1}\n'));
    const read = await p.get("entity/boulder-creek/status.json");
    expect(read).toMatchObject({ body: '{"a":1}\n', cacheControl: CACHE_CONTROL.latest, etag });
    expect(await p.get("entity/nobody/status.json")).toBeNull();
  });
});

describe("publishStatus", () => {
  it("validates against statusFileSchema and publishes with the latest class", async () => {
    const dir = await tmpDir();
    const p = new LocalDirPublisher(dir);
    const out = await publishStatus("boulder-creek", statusFile, p);
    expect(out.key).toBe(statusKey("boulder-creek"));
    const read = await p.get(out.key);
    expect(read!.cacheControl).toBe(CACHE_CONTROL.latest);
    // extras the page ignores survive the round trip
    expect(JSON.parse(read!.body).event_chain_head).toBe("abc");
  });

  it("refuses to replace a good file with a malformed one", async () => {
    const dir = await tmpDir();
    const p = new LocalDirPublisher(dir);
    await expect(publishStatus("boulder-creek", { ...statusFile, snapshot: { ...snapshot, mood: "grumpy" } }, p)).rejects.toThrow(/statusFileSchema/);
    expect(await p.get(statusKey("boulder-creek"))).toBeNull();
  });
});

describe("R2Publisher", () => {
  it("is unconfigured without credentials and PUTs with the cache class when configured", async () => {
    expect(r2EnvFrom({} as NodeJS.ProcessEnv)).toBeNull();
    const env = r2EnvFrom({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s" } as unknown as NodeJS.ProcessEnv)!;
    expect(env.R2_BUCKET).toBe("kami-data");
    const sent: Array<Record<string, unknown>> = [];
    const fake = { send: async (cmd: { input: Record<string, unknown> }) => { sent.push(cmd.input); return { ETag: '"e"' }; } };
    const p = new R2Publisher(env, fake as never);
    const out = await p.put("entity/x/status.json", "{}", { contentType: "application/json", cacheControl: CACHE_CONTROL.latest });
    expect(out.etag).toBe('"e"');
    expect(sent[0]).toMatchObject({ Bucket: "kami-data", Key: "entity/x/status.json", CacheControl: CACHE_CONTROL.latest, ContentType: "application/json" });
  });
});
