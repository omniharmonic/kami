/**
 * The two routes behind the connect page.
 *
 * `status` is polled every few seconds by a screen someone is watching to see
 * their agent's first call land, so its honesty is the feature: it must be
 * role-scoped, uncacheable, and carry no token value. `bundle` is a download,
 * so what matters is that it is a real archive and that it contains no secret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inflateRawSync } from "node:zlib";

type User = { id: string; email: string; name: string | null; age_gate_ok: boolean; platform_admin: boolean };
let currentUser: User | null = null;

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return { ...actual, getSession: async () => (currentUser ? { user: currentUser, expiresAt: new Date(Date.now() + 3_600_000) } : null) };
});

import * as schema from "@/db/schema";
import { setDbForTests } from "@/db/client";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import { mintConnectToken } from "@/lib/connect/token";
import type { ConnectStatus } from "@/lib/connect/status";
import { connectTestDb, seedConnectEntity } from "@/lib/connect/__tests__/helpers";
import { GET as statusGet } from "../status/route";
import { GET as bundleGet } from "../bundle/route";

const maya: User = { id: "u-maya", email: "maya@example.org", name: "Maya", age_gate_ok: true, platform_admin: false };
const nobody: User = { id: "u-nobody", email: "nobody@example.org", name: null, age_gate_ok: true, platform_admin: false };

let db: TestDb;
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (url = "https://kami.test/api/entities/boulder-creek/connect/status") => new Request(url, { headers: { host: "kami.test", "x-forwarded-proto": "https" } });

beforeEach(async () => {
  db = await connectTestDb();
  setDbForTests(db);
  await seedConnectEntity(db, "boulder-creek");
  await db.insert(schema.entityRoles).values({ entityId: "entity/boulder-creek", userId: "u-maya", role: "steward", acceptedAt: new Date() });
  currentUser = maya;
});

afterEach(async () => {
  currentUser = null;
  setDbForTests(null);
  await closeTestDb(db);
});

describe("GET /api/entities/[slug]/connect/status", () => {
  it("answers a role-holder with every signal, uncacheable, and no token value", async () => {
    const minted = await mintConnectToken(db, { id: "entity/boulder-creek", slug: "boulder-creek" }, "u-maya");
    const res = await statusGet(req(), params("boulder-creek"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as ConnectStatus;
    expect(body.signals.map((s) => s.key)).toEqual(["token", "mcp_call", "mcp_tool", "pulse", "gate", "chat"]);
    expect(JSON.stringify(body)).not.toContain(minted.token);
    expect(body.token.fingerprint).toHaveLength(8);
  });

  it("refuses a stranger and an anonymous caller", async () => {
    currentUser = nobody;
    expect((await statusGet(req(), params("boulder-creek"))).status).toBe(403);
    currentUser = null;
    expect((await statusGet(req(), params("boulder-creek"))).status).toBe(401);
  });

  it("is honest about an entity that does not exist and a slug that is not one", async () => {
    expect((await statusGet(req(), params("no-such-creek"))).status).toBe(404);
    expect((await statusGet(req(), params("Not A Slug"))).status).toBe(400);
  });

  it("reports waiting rather than seen while nothing has arrived", async () => {
    await mintConnectToken(db, { id: "entity/boulder-creek", slug: "boulder-creek" }, "u-maya");
    const body = (await (await statusGet(req(), params("boulder-creek"))).json()) as ConnectStatus;
    const call = body.signals.find((s) => s.key === "mcp_call")!;
    expect(call.state).toBe("waiting");
    expect(call.at).toBeNull();
  });
});

describe("GET /api/entities/[slug]/connect/bundle", () => {
  const bundleReq = (qs = "") => new Request(`https://kami.test/api/entities/boulder-creek/connect/bundle${qs}`, { headers: { host: "kami.test", "x-forwarded-proto": "https" } });

  it("serves a zip that unpacks, named after the entity and the day", async () => {
    const res = await bundleGet(bundleReq(), params("boulder-creek"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="kami-boulder-creek-connect-\d{4}-\d{2}-\d{2}\.zip"/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // PK\003\004 — a real local file header, and the first entry inflates
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const view = new DataView(bytes.buffer);
    const nameLen = view.getUint16(26, true);
    const compressed = view.getUint32(18, true);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLen));
    expect(name).toBe("SOUL.md");
    const data = bytes.slice(30 + nameLen + view.getUint16(28, true), 30 + nameLen + view.getUint16(28, true) + compressed);
    expect(new TextDecoder().decode(view.getUint16(8, true) === 8 ? inflateRawSync(data) : data)).toContain("Hard rules");
  });

  it("serves the same files as JSON for copy-paste, carrying no token", async () => {
    const res = await bundleGet(bundleReq("?format=json"), params("boulder-creek"));
    const body = (await res.json()) as { files: Array<{ path: string; content: string }>; endpoint: string };
    expect(body.endpoint).toBe("https://kami.test/mcp");
    expect(body.files.map((f) => f.path)).toContain("mcp.json");
    expect(JSON.stringify(body)).not.toMatch(/kami_[a-z0-9-]+_[0-9a-f]{48}/);
  });

  it("refuses a stranger", async () => {
    currentUser = nobody;
    expect((await bundleGet(bundleReq(), params("boulder-creek"))).status).toBe(403);
  });

  it("says which piece is missing rather than half-rendering a bundle", async () => {
    await seedConnectEntity(db, "no-soul-creek", { withSoul: false, createdBy: "u-maya" });
    const res = await bundleGet(new Request("https://kami.test/api/entities/no-soul-creek/connect/bundle"), params("no-soul-creek"));
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("no_soul");
  });
});
