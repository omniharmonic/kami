import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { createAuth, SESSION_MAX_AGE_S, type Auth } from "../auth";

let db: TestDb;
let auth: Auth;
const sent: Array<{ email: string; url: string; token: string }> = [];
const BASE = "http://localhost:3000";

beforeAll(async () => {
  db = await createTestDb();
  auth = createAuth({
    db,
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: BASE,
    sendMagicLink: async (d) => {
      sent.push(d);
    },
  });
});
afterAll(async () => {
  await closeTestDb(db);
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return auth.handler(new Request(`${BASE}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, ...headers }, body: JSON.stringify(body) }));
}

describe("Better Auth magic links + age gate", () => {
  it("refuses a magic link without the 13-or-older declaration", async () => {
    const res = await post("/sign-in/magic-link", { email: "kid@example.org", callbackURL: "/" });
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.code).toBe("AGE_GATE_REQUIRED");
    expect(sent).toHaveLength(0);
  });

  it("sends a magic link when the declaration is in metadata", async () => {
    const res = await post("/sign-in/magic-link", { email: "Ada@Example.org", callbackURL: "/", metadata: { age_gate_ok: true } });
    expect(res.status, await res.text().catch(() => "")).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toContain("/api/auth/magic-link/verify?token=");
  });

  it("verifying the link creates the user with age_gate_ok = true, no password, and a 30-day session", async () => {
    const { token } = sent[0]!;
    const res = await auth.handler(new Request(`${BASE}/api/auth/magic-link/verify?token=${token}`, { headers: { origin: BASE } }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { user: { email: string }; session: { expiresAt: string } };
    expect(j.user.email).toBe("ada@example.org");
    const expires = new Date(j.session.expiresAt).getTime() - Date.now();
    expect(expires).toBeGreaterThan((SESSION_MAX_AGE_S - 60) * 1000);
    expect(expires).toBeLessThanOrEqual(SESSION_MAX_AGE_S * 1000 + 1000);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("kami.session_token=");
    expect(cookie).toMatch(/Max-Age=2592000/);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, "ada@example.org"));
    expect(user!.ageGateOk).toBe(true);
    expect(user!.emailVerified).toBe(true);
    const accounts = await db.select().from(schema.account);
    expect(accounts.every((a) => a.password === null)).toBe(true);
  });

  it("accepts the header form of the declaration (used by the server action)", async () => {
    const res = await post("/sign-in/magic-link", { email: "bob@example.org" }, { "x-kami-age-gate": "confirmed" });
    expect(res.status).toBe(200);
  });

  it("has no email+password endpoint", async () => {
    const res = await post("/sign-up/email", { email: "x@example.org", password: "hunter22", name: "x" });
    expect([400, 404, 405]).toContain(res.status);
  });
});
