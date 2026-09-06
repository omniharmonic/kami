import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { parsePauseArgs, runPause, UsageError, validateGuardians } from "../src/pause.js";
import { drillReport, TARGET_MS } from "../src/pause-drill.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kami-pause-"));

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("pause.ts", () => {
  it("one guardian can pause", () => {
    const a = parsePauseArgs(["boulder-creek", "--guardians", "ada"]);
    expect(a.resume).toBe(false);
    expect(a.guardians).toEqual(["ada"]);
  });

  it("resume with one name is a usage error; two identical names too; two distinct names pass", () => {
    expect(() => parsePauseArgs(["boulder-creek", "--resume", "--guardians", "ada"])).toThrow(UsageError);
    expect(() => parsePauseArgs(["boulder-creek", "--resume"])).toThrow(UsageError);
    expect(() => validateGuardians({ resume: true, guardians: ["Ada", "ada"] })).toThrow(UsageError);
    expect(parsePauseArgs(["boulder-creek", "--resume", "--guardians", "ada, grace"]).guardians).toEqual(["ada", "grace"]);
  });

  it("CLI: resume with one name exits non-zero (2)", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/pause.ts", "boulder-creek", "--resume", "--guardians", "ada"], {
      cwd: path.join(import.meta.dirname, ".."),
      encoding: "utf8",
      timeout: 25_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("two distinct guardian names");
  });

  it("pause POSTs the gate with X-Gate-Admin, calls the platform when set, prints the Hermes call, writes the marker", async () => {
    const { f, calls } = fakeFetch(200);
    const logs: string[] = [];
    const stateDir = tmp();
    const res = await runPause(parsePauseArgs(["boulder-creek", "--guardians", "ada", "--reason", "drill"]), {
      fetch: f,
      env: { GATE_ADMIN_URL: "http://127.0.0.1:8001", GATE_ADMIN_SECRET: "s3", PLATFORM_URL: "https://platform.test/", PLATFORM_ADMIN_TOKEN: "pt" },
      log: (l) => logs.push(l),
      now: () => new Date("2026-09-06T12:00:00Z"),
      stateDir,
    });
    expect(calls[0]!.url).toBe("http://127.0.0.1:8001/admin/pause/boulder-creek");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Gate-Admin"]).toBe("s3");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ guardians: ["ada"], reason: "drill", action: "pause" });
    expect(calls[1]!.url).toBe("https://platform.test/api/entities/boulder-creek/pause");
    expect(res.gate).toBe(200);
    expect(res.platform).toBe(200);
    expect(res.hermesCommand).toContain("/api/jobs/pause");
    expect(logs.join("\n")).toContain("/api/jobs/pause");
    expect(fs.readFileSync(path.join(stateDir, "paused"), "utf8")).toContain("ada");
  });

  it("resume DELETEs the gate pause and removes the marker; a gate failure throws", async () => {
    const stateDir = tmp();
    fs.writeFileSync(path.join(stateDir, "paused"), "x\n");
    const { f, calls } = fakeFetch(200);
    await runPause(parsePauseArgs(["boulder-creek", "--resume", "--guardians", "ada,grace"]), {
      fetch: f, env: {}, log: () => {}, now: () => new Date(), stateDir,
    });
    expect(calls[0]!.init.method).toBe("DELETE");
    expect(calls).toHaveLength(1); // no PLATFORM_URL → no platform call
    expect(fs.existsSync(path.join(stateDir, "paused"))).toBe(false);

    const bad = fakeFetch(500);
    await expect(
      runPause(parsePauseArgs(["boulder-creek", "--guardians", "ada"]), { fetch: bad.f, env: {}, log: () => {}, now: () => new Date(), stateDir }),
    ).rejects.toThrow(/gate answered 500/);
  });

  it("--dry-run touches nothing", async () => {
    const { f, calls } = fakeFetch();
    const stateDir = tmp();
    await runPause(parsePauseArgs(["boulder-creek", "--guardians", "ada", "--dry-run"]), { fetch: f, env: {}, log: () => {}, now: () => new Date(), stateDir });
    expect(calls).toHaveLength(0);
    expect(fs.existsSync(path.join(stateDir, "paused"))).toBe(false);
  });
});

describe("pause-drill report", () => {
  it("renders PASS under the target and FAIL when the gate never returned 423", () => {
    const base = { slug: "boulder-creek", startedAt: "2026-09-06T12:00:00.000Z", operator: "ada", timeoutS: 90, resumedBy: null, notes: [] as string[] };
    const pass = drillReport({ ...base, gateMs: 1200, platformMs: "not checked" });
    expect(pass).toContain("# Pause drill — 2026-09-06");
    expect(pass).toContain("**PASS**");
    expect(pass).toContain("1200 ms");
    expect(pass).toContain(`≤ ${TARGET_MS} ms`);
    const fail = drillReport({ ...base, gateMs: null, platformMs: 3000, resumedBy: ["ada", "grace"], notes: ["gate down"] });
    expect(fail).toContain("**FAIL**");
    expect(fail).toContain("no 423 within 90 s");
    expect(fail).toContain("by ada and grace");
    expect(fail).toContain("- gate down");
  });
});
