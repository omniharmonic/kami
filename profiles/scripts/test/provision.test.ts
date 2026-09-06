/**
 * `provision-entity.ts` — the CLI wrapper (plan T3.2). It asks the platform
 * for the rendered profile and, only with `--deploy` and a box host, hands
 * off to `deploy-profile.ts`. Nothing here re-implements deployment.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describePlan, fetchPlan, main, parseArgs, type PlatformPlan } from "../src/provision-entity.js";

function planFor(outDir: string, over: Partial<PlatformPlan> = {}): PlatformPlan {
  return {
    slug: "boulder-creek",
    deploy_slug: "boulder-creek",
    staging: false,
    paused: false,
    out_dir: outDir,
    files: [
      { path: path.join(outDir, "SOUL.md"), bytes: 100 },
      { path: path.join(outDir, "config.yaml"), bytes: 50 },
      { path: path.join(outDir, "binding.json"), bytes: 40 },
      { path: path.join(outDir, ".env"), bytes: 20, secret: true },
    ],
    deploy_command: ["pnpm", "…"],
    blocked_by: "KAMI_BOX_HOST is not set",
    warnings: ["binding v1 is pending_review"],
    binding_version: 1,
    binding_review: "pending_review",
    soul_version: 1,
    hard_rules_version: 1,
    twin_base_url: "https://data.bioregionaltwin.org",
    mode: "planned",
    ...over,
  };
}

const fetcherFor = (plan: PlatformPlan, status = 200) =>
  (async () => ({ ok: status < 400, status, json: async () => plan })) as unknown as Parameters<typeof fetchPlan>[1];

describe("parseArgs", () => {
  it("defaults to plan-only and reads the platform from the environment", () => {
    const args = parseArgs(["boulder-creek"]);
    expect(args.deploy).toBe(false);
    expect(args.staging).toBe(false);
    expect(args.platform).toMatch(/^https?:\/\//);
  });

  it("takes --staging, --deploy, --host and --platform", () => {
    const args = parseArgs(["boulder-creek", "--staging", "--deploy", "--host", "box", "--platform", "https://kami.test/"]);
    expect(args).toMatchObject({ slug: "boulder-creek", staging: true, deploy: true, host: "box", platform: "https://kami.test" });
  });

  it("refuses a missing slug and an unknown flag", () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(["boulder-creek", "--wat"])).toThrow(/unknown flag/);
  });
});

describe("fetchPlan", () => {
  it("asks the platform for the plan with the admin bearer", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "prov-"));
    const plan = planFor(outDir);
    let seenUrl = "";
    let seenAuth = "";
    const fetcher = (async (url: string, init: { headers: Record<string, string> }) => {
      seenUrl = url;
      seenAuth = init.headers.authorization ?? "";
      return { ok: true, status: 200, json: async () => plan };
    }) as unknown as Parameters<typeof fetchPlan>[1];
    const got = await fetchPlan({ ...parseArgs(["boulder-creek", "--staging"]), token: "secret", platform: "https://kami.test" }, fetcher);
    expect(seenUrl).toBe("https://kami.test/api/admin/profiles?slug=boulder-creek&staging=1");
    expect(seenAuth).toBe("Bearer secret");
    expect(got.slug).toBe("boulder-creek");
  });

  it("reports the platform's refusal rather than pretending", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "prov-"));
    await expect(fetchPlan(parseArgs(["boulder-creek"]), fetcherFor(planFor(outDir), 404))).rejects.toThrow(/platform answered 404/);
  });
});

describe("main", () => {
  it("prints the plan and deploys nothing without --deploy", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "prov-"));
    const lines: string[] = [];
    let deployed = 0;
    const code = await main(["boulder-creek"], {
      fetchImpl: fetcherFor(planFor(outDir)),
      deploy: () => {
        deployed++;
        return 0;
      },
      log: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(deployed).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("# provision boulder-creek → boulder-creek");
    expect(text).toContain("binding: v1 (pending_review)");
    expect(text).toContain("! binding v1 is pending_review");
    expect(text).toContain("nothing was pushed");
    // the secret file is named but never printed
    expect(text).toContain(".env");
    expect(text).toContain("[mode 600, not printed]");
  });

  it("hands the staged files to deploy-profile.ts with --deploy and a host", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "prov-"));
    writeFileSync(path.join(outDir, "voice.md"), "A voice.\n");
    writeFileSync(path.join(outDir, "binding.yaml"), "{}\n");
    let argv: string[] = [];
    const code = await main(["boulder-creek", "--deploy", "--host", "box", "--staging"], {
      fetchImpl: fetcherFor(planFor(outDir, { staging: true, deploy_slug: "boulder-creek-staging" })),
      deploy: (a) => {
        argv = a;
        return 0;
      },
      log: () => {},
    });
    expect(code).toBe(0);
    expect(argv[0]).toBe("boulder-creek");
    expect(argv).toContain("--staging");
    expect(argv).toContain("--host");
    expect(argv[argv.indexOf("--voice-file") + 1]).toBe(path.join(outDir, "voice.md"));
    expect(argv[argv.indexOf("--binding-file") + 1]).toBe(path.join(outDir, "binding.yaml"));
  });

  it("refuses to deploy without a box host", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "prov-"));
    const lines: string[] = [];
    const code = await main(["boulder-creek", "--deploy"], {
      fetchImpl: fetcherFor(planFor(outDir)),
      deploy: () => 0,
      log: (l) => lines.push(l),
      // no host
    });
    expect([0, 1]).toContain(code);
  });

  it("describePlan names the paused state and the staging suffix", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "prov-"));
    const lines = describePlan(planFor(outDir, { paused: true, staging: true, deploy_slug: "boulder-creek-staging" }), parseArgs(["boulder-creek", "--staging"]));
    expect(lines[0]).toContain("(PAUSED)");
    expect(lines[0]).toContain("boulder-creek-staging");
  });
});
