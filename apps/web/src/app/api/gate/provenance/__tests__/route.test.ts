/**
 * `POST /api/gate/provenance` — the gate's report of where its model runs.
 *
 * The point of the route is that the public page renders a reported fact. So the
 * things worth testing are: an unauthenticated report is refused, a report
 * without a placement is refused (the gate cannot start without one, so nothing
 * legitimate posts one), and what lands in `config` is exactly what
 * `src/lib/provenance.ts` reads back — including the `at` timestamp that makes a
 * stale report show as last-known rather than as current fact.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { setDbForTests, type Db } from "@/db/client";
import { getConfig } from "@/lib/jobs/common";
import { parseGateReport } from "@/lib/provenance";
import { POST } from "../route";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => closeTestDb(d)));
  setDbForTests(null);
});
afterEach(() => {
  delete process.env.GATE_ADMIN_SECRET;
});

async function fresh(): Promise<TestDb> {
  const db = await createTestDb();
  dbs.push(db);
  setDbForTests(db as unknown as Db);
  process.env.GATE_ADMIN_SECRET = "gate-secret";
  return db;
}

const post = (body: unknown, headers: Record<string, string> = { "x-gate-admin": "gate-secret" }) =>
  POST(new Request("https://kami.test/api/gate/provenance", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

const REPORT = {
  at: "2026-09-06T05:00:00Z",
  host: "box-1",
  gate_version: "0.1.0",
  slug: "boulder-creek",
  provenance: { placement: "hosted", provider: "OpenRouter", model: "qwen/qwen3.5-9b-instruct", upstream_url: "https://openrouter.ai/api", authenticated: true, api_key_env: "OPENROUTER_API_KEY", guard: "factguard" },
};

describe("POST /api/gate/provenance", () => {
  it("stores the gate's report where the page reads it", async () => {
    const db = await fresh();
    const res = await post(REPORT);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ key: "gate_provenance.boulder-creek", reported_at: "2026-09-06T05:00:00.000Z" });

    const stored = await getConfig<Record<string, unknown>>(db, "gate_provenance.boulder-creek");
    expect(stored).toMatchObject({ placement: "hosted", provider: "OpenRouter", model: "qwen/qwen3.5-9b-instruct", host: "box-1", api_key_env: "OPENROUTER_API_KEY" });
    // the reader's contract: placement, provider, model and a usable `at`
    expect(parseGateReport(stored)).toMatchObject({ placement: "hosted", provider: "OpenRouter", model: "qwen/qwen3.5-9b-instruct", at: "2026-09-06T05:00:00.000Z" });
  });

  it("falls back to the box-wide key when the gate serves every kami from one upstream", async () => {
    const db = await fresh();
    expect((await post({ ...REPORT, slug: undefined })).status).toBe(200);
    expect(await getConfig(db, "gate_provenance.default")).toBeTruthy();
  });

  it("accepts a bare provenance object, for debugging a box by hand", async () => {
    const db = await fresh();
    const res = await post({ placement: "owned", provider: "vLLM on the GPU box", model: "qwen3.5-9b" });
    expect(res.status).toBe(200);
    expect(await getConfig<Record<string, unknown>>(db, "gate_provenance.default")).toMatchObject({ placement: "owned" });
  });

  it("refuses a report with no placement — a gate that cannot say where it runs does not start", async () => {
    const db = await fresh();
    const res = await post({ provenance: { provider: "OpenRouter" } });
    expect(res.status).toBe(400);
    expect(await getConfig(db, "gate_provenance.default")).toBeUndefined();
    expect((await post({ provenance: { placement: "somewhere-else" } })).status).toBe(400);
  });

  it("refuses an unauthenticated report and one with the wrong secret", async () => {
    const db = await fresh();
    expect((await post(REPORT, {})).status).toBe(401);
    expect((await post(REPORT, { "x-gate-admin": "wrong" })).status).toBe(401);
    expect(await getConfig(db, "gate_provenance.boulder-creek")).toBeUndefined();
  });

  it("refuses a slug that is not a slug", async () => {
    await fresh();
    expect((await post({ ...REPORT, slug: "../../etc/passwd" })).status).toBe(400);
  });
});
