/**
 * The three routes the summon flow adds: the debounced place search, the
 * preview chat, and the two admin endpoints the box talks to.
 *
 * The preview's contract is the interesting one: guarded like production, and
 * honest when the gateway is not there. `HERMES_GATEWAY_URL=fake:` is the
 * sandbox's gateway (vitest sets it through `src/env.ts`'s default).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

const session = { user: { id: "u-maya", email: "maya@example.org", name: null, age_gate_ok: true, platform_admin: false }, expiresAt: new Date(Date.now() + 3600_000) };
let currentSession: typeof session | null = session;

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return {
    ...actual,
    getSession: async () => currentSession,
    requireUser: async () => {
      if (!currentSession) throw new actual.AuthError(401, "sign in");
      return currentSession.user;
    },
    requireAdmin: async () => {
      if (!currentSession?.user.platform_admin) throw new actual.AuthError(403, "no");
      return currentSession.user;
    },
  };
});

import * as schema from "@/db/schema";
import { setDbForTests } from "@/db/client";
import { setConfig } from "@/lib/jobs/common";
import { GET as searchRoute } from "@/app/api/summon/search/route";
import { POST as previewRoute } from "@/app/api/summon/preview/route";
import { GET as gateRoute } from "@/app/api/admin/gate/route";
import { GET as profilesRoute } from "@/app/api/admin/profiles/route";
import { bindTwinTo, closeTestDb, createTestDb, seedUser, writeOtherTwinTree, type TestDb } from "./helpers";
import { twinBaseUrlKey, twinTreeDirKey, resetTwinClientsForTests } from "../twin";

let db: TestDb;
let otherDir: string;

beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db as never);
  await seedUser(db, "u-maya", "maya@example.org");
  otherDir = writeOtherTwinTree();
  // The default twin (slug "new") points at the fixture tree, so the search
  // route reads a local directory instead of the network.
  await setConfig(db, twinTreeDirKey("new"), otherDir);
  await setConfig(db, twinBaseUrlKey("new"), "https://data.othertwin.example");
  resetTwinClientsForTests();
});
afterAll(async () => {
  setDbForTests(null);
  await closeTestDb(db);
});
beforeEach(() => {
  currentSession = session;
});

const url = (path: string) => new Request(`https://kami.test${path}`);

describe("GET /api/summon/search", () => {
  it("refuses an anonymous caller", async () => {
    currentSession = null;
    const res = await searchRoute(url("/api/summon/search?q=salmon"));
    expect(res.status).toBe(401);
  });

  it("needs at least one filter", async () => {
    const res = await searchRoute(url("/api/summon/search"));
    expect(res.status).toBe(400);
  });

  it("searches the twin server-side and paginates", async () => {
    const res = await searchRoute(url("/api/summon/search?q=salmon&slug=new&limit=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { places: Array<{ id: string }>; total: number; next_cursor: string | null; kinds: string[] };
    expect(body.total).toBe(2);
    expect(body.places).toHaveLength(1);
    expect(body.next_cursor).toBe("1");
    expect(body.kinds).toEqual(["monitoring_site", "watershed"]);

    const page2 = await searchRoute(url("/api/summon/search?q=salmon&slug=new&limit=1&cursor=1"));
    const body2 = (await page2.json()) as { places: Array<{ id: string }>; next_cursor: string | null };
    expect(body2.places[0]!.id).not.toBe(body.places[0]!.id);
    expect(body2.next_cursor).toBeNull();
  });

  it("filters by kind and HUC prefix", async () => {
    const byKind = await searchRoute(url("/api/summon/search?q=salmon&kind=watershed&slug=new"));
    const kindBody = (await byKind.json()) as { total: number };
    expect(kindBody.total).toBe(1);
    const byHuc = await searchRoute(url("/api/summon/search?q=salmon&huc=1710&slug=new"));
    const hucBody = (await byHuc.json()) as { total: number };
    expect(hucBody.total).toBe(2);
    const bad = await searchRoute(url("/api/summon/search?q=salmon&huc=abc&slug=new"));
    expect(bad.status).toBe(400);
  });
});

describe("POST /api/summon/preview", () => {
  const body = (over: Record<string, unknown> = {}) =>
    new Request("https://kami.test/api/summon/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "What is the flow?", voice: "You speak plainly for this creek.", name: "Salmon Creek", slug: "salmon-creek", ...over }),
    });

  it("refuses an anonymous caller", async () => {
    currentSession = null;
    expect((await previewRoute(body())).status).toBe(401);
  });

  it("refuses a voice block that would not be accepted at step 3", async () => {
    const res = await previewRoute(body({ voice: "One. Two. Three. Four." }));
    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("too_long");
  });

  it("labels the reply a preview, names the staging profile, and stores nothing", async () => {
    const res = await previewRoute(body());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { label: string; profile: string; stored: boolean; text: string; disclosure: string; looked_at: unknown[] };
    expect(json.profile).toBe("salmon-creek-staging");
    expect(json.label).toMatch(/Preview/);
    expect(json.stored).toBe(false);
    expect(json.disclosure).toContain("An AI voice for Salmon Creek");
    expect(json.text.length).toBeGreaterThan(0);
    expect(json.looked_at.length).toBeGreaterThan(0);
  });

  it("says the gateway is unreachable rather than faking a reply", async () => {
    const prior = process.env.HERMES_GATEWAY_URL;
    vi.resetModules();
    process.env.HERMES_GATEWAY_URL = "fake:asleep";
    const { POST } = await import("@/app/api/summon/preview/route");
    const res = await POST(body());
    expect(res.status).toBe(503);
    const json = (await res.json()) as { reason: string; message: string; text?: string };
    expect(json.reason).toBe("gateway_unreachable");
    expect(json.message).toMatch(/gateway is not answering/);
    expect(json.text).toBeUndefined();
    process.env.HERMES_GATEWAY_URL = prior ?? "fake:";
    vi.resetModules();
  });

  it("passes a paused staging profile's refusal straight through", async () => {
    const prior = process.env.HERMES_GATEWAY_URL;
    vi.resetModules();
    process.env.HERMES_GATEWAY_URL = "fake:paused";
    const { POST } = await import("@/app/api/summon/preview/route");
    const res = await POST(body());
    expect(res.status).toBe(423);
    process.env.HERMES_GATEWAY_URL = prior ?? "fake:";
    vi.resetModules();
  });
});

describe("the admin endpoints the box fetches", () => {
  beforeAll(async () => {
    await db.insert(schema.entities).values({ id: "entity/salmon-creek", slug: "salmon-creek", name: "Salmon Creek", archetype: "creek", hermesProfile: "salmon-creek", bindingVersion: 1, soulVersion: 1, createdBy: "u-maya" });
    await db.insert(schema.entityBindings).values({ entityId: "entity/salmon-creek", bindingVersion: 1, binding: { anchor: "place/salmon-creek-at-tidewater-or" } as unknown as object, sha256: "c".repeat(64), review: "approved" });
    await db.insert(schema.souls).values({ entityId: "entity/salmon-creek", soulVersion: 1, hardRulesVersion: "1", voiceMd: "You speak plainly for this creek.", editedBy: "u-maya" });
    await bindTwinTo(db, "salmon-creek", otherDir);
  });

  it("refuses a non-admin", async () => {
    expect((await gateRoute(url("/api/admin/gate"))).status).toBe(401);
    expect((await profilesRoute(url("/api/admin/profiles?slug=salmon-creek"))).status).toBe(401);
  });

  it("serves gate.yaml as YAML for the box and JSON for /admin", async () => {
    currentSession = { ...session, user: { ...session.user, platform_admin: true } };
    // The gate refuses to start without knowing where its model runs, so the
    // generator refuses to emit a file that lacks it (see provisioning tests).
    await setConfig(db, "gate.provenance", { placement: "owned", provider: "vLLM on the GPU box", model: "qwen3.5-9b" });
    const res = await gateRoute(url("/api/admin/gate?platform_url=https://kami.test"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/yaml");
    const text = await res.text();
    const parsed = parseYaml(text) as { budgets: Record<string, unknown>; paused: string[]; platform: { pause_set_url: string } };
    expect(Object.keys(parsed.budgets)).toContain("salmon-creek");
    expect(Object.keys(parsed.budgets)).toContain("salmon-creek-staging");
    expect(parsed.platform.pause_set_url).toBe("https://kami.test/api/gate/pause-set");
    expect(text).not.toMatch(/kami_[a-z0-9-]+_[0-9a-f]{48}/);

    const asJson = await gateRoute(url("/api/admin/gate?format=json"));
    expect(asJson.headers.get("content-type")).toContain("application/json");
  });

  it("returns a provisioning plan without deploying and without leaking the token", async () => {
    currentSession = { ...session, user: { ...session.user, platform_admin: true } };
    const res = await profilesRoute(url("/api/admin/profiles?slug=salmon-creek"));
    expect(res.status).toBe(200);
    const plan = (await res.json()) as { mode: string; files: Array<{ path: string; secret?: boolean; note?: string }>; blocked_by: string; twin_base_url: string };
    expect(plan.mode).toBe("planned");
    expect(plan.blocked_by).toMatch(/KAMI_BOX_HOST/);
    expect(plan.twin_base_url).toBe("https://data.othertwin.example");
    const env = plan.files.find((f) => f.path.endsWith(".env"))!;
    expect(env.secret).toBe(true);
    expect(env.note).toMatch(/not returned/);
    expect(JSON.stringify(plan)).not.toMatch(/kami_[a-z0-9-]+_[0-9a-f]{48}/);
  });

  it("404s an entity that does not exist", async () => {
    currentSession = { ...session, user: { ...session.user, platform_admin: true } };
    const res = await profilesRoute(url("/api/admin/profiles?slug=nope"));
    expect(res.status).toBe(404);
  });
});
