import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { buildPlan, parseArgs, writeBuild } from "../src/deploy-profile.js";
import { PROFILES_DIR } from "../src/lib/paths.js";
import { assertNoChainKey, bindingYamlToJson, TemplateError } from "../src/lib/config.js";

const BC = path.join(PROFILES_DIR, "boulder-creek");
const FIXTURE_BINDING = path.join(import.meta.dirname, "fixtures", "binding.yaml");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kami-deploy-"));

describe("deploy-profile plan", () => {
  it("dry-run reproduces the committed Boulder Creek goldens", () => {
    const plan = buildPlan({ slug: "boulder-creek", dryRun: true, stateDir: tmp() });
    expect(plan.files.get("SOUL.md")).toBe(fs.readFileSync(path.join(BC, "SOUL.md"), "utf8"));
    expect(plan.files.get("config.yaml")).toBe(fs.readFileSync(path.join(BC, "config.yaml"), "utf8"));
    expect(plan.paused).toBe(false);
    expect(plan.deploySlug).toBe("boulder-creek");
    // .env has only the two keys
    const envKeys = plan.files.get(".env")!.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("=")[0]);
    expect(envKeys).toEqual(["PLATFORM_MCP_TOKEN", "KAMI_ENTITY_SLUG"]);
    // profiles/boulder-creek/binding.yaml now exists, so the plan converts it to
    // binding.json. (Before that file landed this asserted the warning path
    // instead; the warning path is still covered by the missing-binding test.)
    expect(plan.files.has("binding.json")).toBe(true);
    const binding = JSON.parse(plan.files.get("binding.json")!);
    expect(binding.entity_id).toBe("entity/boulder-creek");
    expect(binding.anchor).toBe("place/boulder-creek-near-orodell-co");
  });

  it("config.yaml points at the gate, not vLLM, and includes exactly the §5.1 tool lists", () => {
    const plan = buildPlan({ slug: "boulder-creek", dryRun: true, stateDir: tmp() });
    const cfg = parseYaml(plan.files.get("config.yaml")!) as any;
    expect(cfg.model.base_url).toBe("http://127.0.0.1:8001/p/boulder-creek/v1");
    expect(cfg.model.default).toBe("qwen3.5-9b");
    expect(cfg.model.context_length).toBe(65536);
    expect(cfg.memory.memory_enabled).toBe(false);
    expect(cfg.memory.write_approval).toBeUndefined();
    expect(cfg.skills).toBeUndefined();
    expect(cfg.model.api_mode).toBe("chat_completions");
    expect(cfg.fallback_providers).toEqual([]);
    expect(cfg.fallback_model).toEqual([]);
    expect(cfg.cron.max_parallel_jobs).toBe(2);
    expect(cfg.mcp_servers.twin.tools.include).toEqual([
      "list_datasets", "find_places", "find_species", "get_species", "query_ecology", "read_artifact", "resolve_entity", "get_reading_history", "get_place", "get_live", "explain", "get_health", "compare_to_normal",
    ]);
    expect(cfg.mcp_servers.twin.url).toBe("https://mcp.bioregionaltwin.org/mcp");
    expect(cfg.mcp_servers.twin.command).toBeUndefined();
    expect(cfg.mcp_servers.treasury.tools.include).toEqual(["get_balance", "list_pending", "propose_bounty_payout"]);
    expect(cfg.mcp_servers.treasury.args).toEqual(["run", "treasury-mcp", "--entity", "boulder-creek"]);
    expect(cfg.mcp_servers.platform.tools.include).toHaveLength(9);
    expect(cfg.mcp_servers.platform.headers.Authorization).toBe("Bearer ${PLATFORM_MCP_TOKEN}");
    expect(cfg.platform_toolsets.cli).toEqual(["twin", "platform", "treasury"]);
    expect(cfg.agent).toBeUndefined();
  });

  it("--staging suffixes the slug everywhere it matters", () => {
    const plan = buildPlan({ slug: "boulder-creek", dryRun: true, staging: true, stateDir: tmp() });
    expect(plan.deploySlug).toBe("boulder-creek-staging");
    const cfg = parseYaml(plan.files.get("config.yaml")!) as any;
    expect(cfg.model.base_url).toBe("http://127.0.0.1:8001/p/boulder-creek-staging/v1");
    expect(cfg.mcp_servers.treasury.args.at(-1)).toBe("boulder-creek-staging");
    expect(plan.files.get(".env")).toContain("KAMI_ENTITY_SLUG=boulder-creek-staging");
    expect(plan.remoteProfileDir).toBe("/opt/data/profiles/boulder-creek-staging");
    // the SOUL is the same soul — the voice does not change for staging
    expect(plan.files.get("SOUL.md")).toBe(fs.readFileSync(path.join(BC, "SOUL.md"), "utf8"));
  });

  it("state/paused (or --paused) writes paused: true and disables the cron adds", () => {
    const stateDir = tmp();
    fs.writeFileSync(path.join(stateDir, "paused"), "2026-09-06T00:00:00Z guardian-a\n");
    const plan = buildPlan({ slug: "boulder-creek", dryRun: true, stateDir });
    expect(plan.paused).toBe(true);
    expect((parseYaml(plan.files.get("config.yaml")!) as any).paused).toBe(true);
    expect(plan.files.get("state/paused")).toBeDefined();
    expect(plan.remoteCommands.filter((c) => / cron (add|create) /.test(c))).toEqual([]);
    expect(plan.compatibilityBlockers.join(" ")).toContain("verified paused by job ID");
    const viaFlag = buildPlan({ slug: "boulder-creek", dryRun: true, paused: true, stateDir: tmp() });
    expect(viaFlag.paused).toBe(true);
  });

  it("renders binding.json from a binding.yaml and refuses geometry", () => {
    const plan = buildPlan({ slug: "boulder-creek", dryRun: true, stateDir: tmp(), bindingFile: FIXTURE_BINDING, platformMcpToken: "t" });
    const binding = JSON.parse(plan.files.get("binding.json")!);
    expect(binding.entity_id).toBe("entity/boulder-creek");
    expect(binding.members).toHaveLength(3);
    expect(plan.warnings).toEqual([]);
    expect(() => bindingYamlToJson('schema_version: "1.0"\nentity_id: e\narchetype: creek\nmembers: []\nboundary: {type: Polygon, coordinates: [[0,0]]}\n')).toThrow(TemplateError);
    expect(() => bindingYamlToJson("archetype: creek\n")).toThrow(TemplateError);
  });

  it("reports runtime blockers and emits no fictional cron or reload commands", () => {
    const plan = buildPlan({ slug: "boulder-creek", dryRun: true, stateDir: tmp(), host: "gpu-box" });
    expect(plan.compatibilityBlockers.join(" ")).toMatch(/pre-script wake gating/);
    expect(plan.remoteCommands.join(" ")).not.toMatch(/cron add|cron create|reload|cron doctor/);
    expect(plan.remoteCommands.at(-1)).toContain("cron list --all");
    expect(plan.rsyncCommand.at(-1)).toBe("gpu-box:~/.hermes/profiles/boulder-creek/");
  });

  it("blocks real deployment before remote mutation, including paused profiles", () => {
    for (const paused of [false, true]) {
      expect(() => buildPlan({ slug: "boulder-creek", stateDir: tmp(), paused, platformMcpToken: "test-only" })).toThrow(/blocked before file transfer/);
    }
  });

  it("without --large-model the 27B override is not applied", () => {
    const plan = buildPlan({ slug: "boulder-creek", dryRun: true, stateDir: tmp() });
    expect(plan.remoteCommands.some((c) => c.includes("--model"))).toBe(false);
  });

  it("writeBuild lays out the profile directory with the skill copied in", () => {
    const stateDir = tmp();
    const out = path.join(stateDir, "build");
    const plan = buildPlan({ slug: "boulder-creek", dryRun: true, stateDir, bindingFile: FIXTURE_BINDING });
    writeBuild(plan, out);
    for (const f of ["SOUL.md", "config.yaml", ".env", "binding.json", "skills/entity-steward/SKILL.md",
      "skills/entity-steward/scripts/pulse_precheck.py", "skills/entity-steward/references/needs-model.md",
      "skills/entity-steward/references/templates.md"]) {
      expect(fs.existsSync(path.join(out, f)), f).toBe(true);
    }
  });

  it("refuses to render anything that looks like a chain key (X.1)", () => {
    expect(() => assertNoChainKey(".env", "PLATFORM_MCP_TOKEN=abc\nSAFE_PRO" + "POSER_KEY=x\n")).toThrow(TemplateError);
    expect(() => assertNoChainKey("x", "0x" + "ab".repeat(32))).toThrow(TemplateError);
    expect(() => assertNoChainKey("x", "PLATFORM_MCP_TOKEN=abc")).not.toThrow();
  });

  it("requires PLATFORM_MCP_TOKEN and a binding outside dry-run", () => {
    expect(() => buildPlan({ slug: "boulder-creek", stateDir: tmp(), platformMcpToken: "" })).toThrow(/PLATFORM_MCP_TOKEN/);
    // A real deploy still refuses without a binding; boulder-creek has one now,
    // so the missing case is exercised by pointing at a path that has none.
    expect(() =>
      buildPlan({
        slug: "boulder-creek",
        stateDir: tmp(),
        platformMcpToken: "t",
        bindingFile: path.join(import.meta.dirname, "fixtures", "no-such-binding.yaml"),
      }),
    ).toThrow(/binding/);
    // With its committed binding, rendering works; runtime deploy remains blocked.
    const plan = buildPlan({ slug: "boulder-creek", dryRun: true, stateDir: tmp(), platformMcpToken: "t" });
    expect(plan.files.has("binding.json")).toBe(true);
  });

  it("parses the CLI flags", () => {
    const o = parseArgs(["boulder-creek", "--dry-run", "--host", "box", "--staging", "--paused", "--large-model", "qwen3.8-27b"]);
    expect(o).toMatchObject({ slug: "boulder-creek", dryRun: true, host: "box", staging: true, paused: true, largeModel: "qwen3.8-27b" });
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(["x", "--bogus"])).toThrow(/unknown flag/);
  });
});
