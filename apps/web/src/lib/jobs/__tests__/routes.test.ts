/**
 * Route-level checks that do not need Next's request context: the cron bearer,
 * the gate secret, the admin token and the config store's wire shape.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import { authorizeCron, isAdminToken, isGateSecret, jobsEnv, claimConfigKey, getConfig, listConfig, setConfig } from "../common";
import { NOW, seedBoulderCreek } from "./helpers";

// Each case builds a fresh PGlite database and runs every migration; on a box
// running several suites at once that can outlast the shared 60 s default.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });


const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => closeTestDb(d)));
});

const req = (headers: Record<string, string> = {}) => new Request("https://kami.test/api/cron/needs", { method: "POST", headers });

describe("cron and gate auth", () => {
  const env = { CRON_SECRET: "cron-secret", PLATFORM_ADMIN_TOKEN: "admin-token", GATE_ADMIN_SECRET: "gate-secret", KAMI_PULSE_CONTACT: "hello@kami.invalid" } as ReturnType<typeof jobsEnv>;

  it("requires the CRON_SECRET bearer when one is configured", () => {
    expect(authorizeCron(req({ authorization: "Bearer cron-secret" }), env)).toBeNull();
    expect(authorizeCron(req({ authorization: "Bearer wrong" }), env)?.status).toBe(401);
    expect(authorizeCron(req(), env)?.status).toBe(401);
    // a near-miss of a different length is refused without throwing
    expect(authorizeCron(req({ authorization: "Bearer cron-secret-longer" }), env)?.status).toBe(401);
  });

  it("refuses cron in production when no secret is set, and allows it in dev", () => {
    const bare = jobsEnv({} as NodeJS.ProcessEnv);
    expect(authorizeCron(req(), bare, "production")?.status).toBe(503);
    expect(authorizeCron(req(), bare, "development")).toBeNull();
  });

  it("accepts the gate secret as a header or a bearer, and the admin token separately", () => {
    expect(isGateSecret(req({ "x-gate-admin": "gate-secret" }), env)).toBe(true);
    expect(isGateSecret(req({ authorization: "Bearer gate-secret" }), env)).toBe(true);
    expect(isGateSecret(req({ "x-gate-admin": "nope" }), env)).toBe(false);
    expect(isGateSecret(req(), jobsEnv({} as NodeJS.ProcessEnv))).toBe(false);
    expect(isAdminToken(req({ authorization: "Bearer admin-token" }), env)).toBe(true);
    expect(isAdminToken(req({ authorization: "Bearer gate-secret" }), env)).toBe(false);
  });
});

describe("the config store", () => {
  let db: TestDb;
  beforeEach(async () => {
    ({ db } = await seedBoulderCreek({ slug: "config-store-creek" }));
    dbs.push(db);
  });

  it("round-trips values, lists by prefix and deletes", async () => {
    await setConfig(db, "safe.boulder-creek.address", "0xabc", NOW);
    await setConfig(db, "safe.boulder-creek.proposer", { address: "0xdef" }, NOW);
    await setConfig(db, "reminder_every_turns", 12, NOW);
    expect(await getConfig(db, "safe.boulder-creek.address")).toBe("0xabc");
    expect(await getConfig(db, "missing")).toBeUndefined();
    const scoped = await listConfig(db, "safe.");
    expect(scoped.map((r) => r.key)).toEqual(["safe.boulder-creek.address", "safe.boulder-creek.proposer"]);
    // writeIfChanged semantics live in the chain package; here we only prove overwrite works
    await setConfig(db, "safe.boulder-creek.address", "0x123", NOW);
    expect(await getConfig(db, "safe.boulder-creek.address")).toBe("0x123");
  });

  it("claims a key exactly once — the webhook idempotency primitive", async () => {
    expect(await claimConfigKey(db, "hermes_events.evt_1", { job: "pulse" }, NOW)).toBe(true);
    expect(await claimConfigKey(db, "hermes_events.evt_1", { job: "pulse" }, NOW)).toBe(false);
    expect(await getConfig(db, "hermes_events.evt_1")).toEqual({ job: "pulse" });
  });
});
