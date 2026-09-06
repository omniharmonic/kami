/**
 * Provisioning (plan T3.2) and the generated `gate.yaml` (T3.3).
 *
 * Two properties matter more than the rest: without `KAMI_BOX_HOST` nothing
 * remote is touched and the operator gets an exact plan; and the gate config
 * is *derived* from the database, never hand-written, so the paused set on the
 * box cannot drift from `entities.paused_at`.
 */
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { parse as parseYaml } from "yaml";
import * as schema from "@/db/schema";
import { listEntityEvents } from "@/db/events";
import { closeTestDb, createTestDb, seedUser, type TestDb } from "@/db/test-utils";
import { getConfig, setConfig } from "@/lib/jobs/common";
import { verifyEntityToken } from "@/lib/mcp/tokens";
import { BUDGET_DEFAULTS, CONCURRENCY_DEFAULTS, gateConfig, renderGateYaml, STAGING_DIVISOR } from "../gate";
import { ProvisionError, provisionEntity } from "../provision";

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const GATE_EXAMPLE = path.join(REPO_ROOT, "infra", "box", "gate.yaml.example");

let db: TestDb;

async function seedFullEntity(slug: string, over: { paused?: boolean; retired?: boolean; review?: "pending_review" | "approved" } = {}) {
  const id = `entity/${slug}`;
  await db.insert(schema.entities).values({
    id,
    slug,
    name: slug,
    archetype: "creek",
    bindingVersion: 1,
    soulVersion: 1,
    hermesProfile: slug,
    createdBy: "u-maya",
    pausedAt: over.paused ? new Date() : null,
    retiredAt: over.retired ? new Date() : null,
  });
  await db.insert(schema.entityBindings).values({
    entityId: id,
    bindingVersion: 1,
    binding: {
      schema_version: "1.0",
      binding_version: 1,
      entity_id: id,
      archetype: "creek",
      anchor: "place/boulder-creek-near-orodell-co",
      stream_id: null,
      commons_handle: `wiki/places/named/${slug}`,
      members: [{ id: "place/boulder-creek-near-orodell-co", role: "main_stem_gauge" }],
      watersheds: ["watershed/huc10-1019000504"],
      reach_ids: [],
      boundary: { geometry_urls: [] },
      needs: [{ need: "flow", property: "discharge", places: ["place/boulder-creek-near-orodell-co"], agg: "single" }],
      membership_rule: "watershed name contains 'Boulder Creek'",
      frozen_at: "2026-09-06T00:00:00Z",
      reviewed_by: null,
      twin_index_etag: null,
    } as unknown as object,
    sha256: "a".repeat(64),
    review: over.review ?? "approved",
  });
  await db.insert(schema.souls).values({
    entityId: id,
    soulVersion: 1,
    hardRulesVersion: "1",
    voiceMd: "You speak for this creek plainly. You never claim to be it.",
    editedBy: "u-maya",
  });
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  await seedUser(db, "u-maya", "maya@example.org");
});
afterAll(async () => {
  await closeTestDb(db);
});

describe("provisionEntity without KAMI_BOX_HOST", () => {
  it("returns a plan, writes the four files locally, and touches no remote state", async () => {
    await seedFullEntity("boulder-creek");
    const outDir = mkdtempSync(path.join(tmpdir(), "kami-prov-"));
    const result = await provisionEntity("boulder-creek", db, { boxHost: null, outDir, actor: "u-maya" });

    expect(result.mode).toBe("planned");
    expect(result.exit_code).toBeNull();
    expect(result.blocked_by).toMatch(/KAMI_BOX_HOST is not set/);
    expect(result.deploy_command[0]).toBe("pnpm");
    expect(result.deploy_command.join(" ")).toContain("deploy-profile");
    expect(result.deploy_command.join(" ")).toContain("<KAMI_BOX_HOST>");

    const names = result.files.map((f) => path.basename(f.path)).sort();
    expect(names).toEqual([".env", "SOUL.md", "binding.json", "config.yaml"]);
    for (const f of result.files) expect(existsSync(f.path)).toBe(true);

    const soul = readFileSync(path.join(outDir, "SOUL.md"), "utf8");
    expect(soul.startsWith("<!-- kami:hard-rules v1 start -->")).toBe(true);
    expect(soul).toContain("<!-- kami:voice start -->");
    expect(soul).toContain("You speak for this creek plainly.");

    const config = parseYaml(readFileSync(path.join(outDir, "config.yaml"), "utf8")) as { model: { base_url: string }; paused: boolean };
    expect(config.model.base_url).toContain("/p/boulder-creek/v1");
    expect(config.paused).toBe(false);

    const binding = JSON.parse(readFileSync(path.join(outDir, "binding.json"), "utf8")) as { anchor: string };
    expect(binding.anchor).toBe("place/boulder-creek-near-orodell-co");

    // the per-entity token was minted and only its hash is in the database
    const env = readFileSync(path.join(outDir, ".env"), "utf8");
    const token = /PLATFORM_MCP_TOKEN=(\S+)/.exec(env)![1]!;
    expect(token.startsWith("kami_boulder-creek_")).toBe(true);
    expect(await verifyEntityToken(db, token)).toEqual({ slug: "boulder-creek" });
    const stored = await getConfig<{ sha256: string }>(db, "entity_tokens.boulder-creek");
    expect(stored!.sha256).not.toContain(token);

    // and the plan is recorded, so an operator can see it was never deployed
    const events = await listEntityEvents(db, "entity/boulder-creek");
    expect(events.map((e) => e.kind)).toContain("profile_planned");
    expect(events.some((e) => e.kind === "profile_deployed")).toBe(false);
  });

  it("does not rotate a live token on a read-only preview", async () => {
    const before = await getConfig<{ sha256: string }>(db, "entity_tokens.boulder-creek");
    const outDir = mkdtempSync(path.join(tmpdir(), "kami-prov-"));
    const result = await provisionEntity("boulder-creek", db, { boxHost: null, outDir, mintToken: false });
    const env = readFileSync(path.join(outDir, ".env"), "utf8");
    expect(env).toContain("PLATFORM_MCP_TOKEN=<minted when this profile is provisioned for real>");
    expect(result.warnings.join(" ")).toMatch(/read-only preview/);
    const after = await getConfig<{ sha256: string }>(db, "entity_tokens.boulder-creek");
    expect(after!.sha256).toBe(before!.sha256);
  });

  it("warns when the binding is still in review, and renders paused: true for a paused kami", async () => {
    await seedFullEntity("left-hand-creek", { review: "pending_review", paused: true });
    const outDir = mkdtempSync(path.join(tmpdir(), "kami-prov-"));
    const result = await provisionEntity("left-hand-creek", db, { boxHost: null, outDir });
    expect(result.warnings.join(" ")).toMatch(/pending_review/);
    expect(result.warnings.join(" ")).toMatch(/paused/);
    expect(result.paused).toBe(true);
    const config = parseYaml(readFileSync(path.join(outDir, "config.yaml"), "utf8")) as { paused: boolean };
    expect(config.paused).toBe(true);
  });

  it("renders the -staging profile the summon preview chats with", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kami-prov-"));
    const result = await provisionEntity("boulder-creek", db, { boxHost: null, outDir, staging: true });
    expect(result.deploy_slug).toBe("boulder-creek-staging");
    expect(result.deploy_command).toContain("--staging");
    const config = parseYaml(readFileSync(path.join(outDir, "config.yaml"), "utf8")) as { model: { base_url: string } };
    expect(config.model.base_url).toContain("/p/boulder-creek-staging/v1");
  });

  it("shells out to deploy-profile.ts when a box host is set", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kami-prov-"));
    const calls: string[][] = [];
    const result = await provisionEntity("boulder-creek", db, {
      boxHost: "box",
      outDir,
      runner: async (argv) => {
        calls.push(argv);
        return { code: 0, output: "# deploy-profile boulder-creek → boulder-creek\n" };
      },
    });
    expect(result.mode).toBe("deployed");
    expect(result.exit_code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.join(" ")).toContain("--host box");
    const events = await listEntityEvents(db, "entity/boulder-creek");
    expect(events.map((e) => e.kind)).toContain("profile_deployed");
  });

  it("refuses an entity with no binding or no soul", async () => {
    await db.insert(schema.entities).values({ id: "entity/bare", slug: "bare", name: "Bare", archetype: "creek", hermesProfile: "bare" });
    await expect(provisionEntity("bare", db, { boxHost: null })).rejects.toBeInstanceOf(ProvisionError);
    await expect(provisionEntity("nope", db, { boxHost: null })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("gate.yaml is generated, never hand-written", () => {
  it("matches the example's schema and carries the paused set", async () => {
    await seedFullEntity("paused-creek", { paused: true });
    await seedFullEntity("retired-creek", { retired: true });

    const config = await gateConfig(db, { platform_url: "https://kami.test" });
    const example = parseYaml(readFileSync(GATE_EXAMPLE, "utf8")) as Record<string, unknown>;

    // same top-level keys as the example the box ships with
    expect(Object.keys(config).sort()).toEqual(Object.keys(example).sort());
    expect(Object.keys(config.budgets["boulder-creek"]!).sort()).toEqual(
      Object.keys((example.budgets as Record<string, object>)["boulder-creek"]!).sort(),
    );
    expect(Object.keys(config.concurrency).sort()).toEqual(Object.keys(example.concurrency as object).sort());
    expect(Object.keys(config.platform).sort()).toEqual(Object.keys(example.platform as object).sort());

    // defaults from §5.7
    expect(config.budgets["boulder-creek"]).toEqual(BUDGET_DEFAULTS);
    expect(config.budgets["boulder-creek-staging"]!.prompt_tokens_per_day).toBe(BUDGET_DEFAULTS.prompt_tokens_per_day / STAGING_DIVISOR);
    expect(config.concurrency).toEqual(CONCURRENCY_DEFAULTS);
    expect(config.passthrough).toBe(false);
    expect(config.platform.pause_set_url).toBe("https://kami.test/api/gate/pause-set");
    expect(config.platform.token).toBe("${GATE_PLATFORM_TOKEN}");

    // the paused set: paused and retired, plus the paused kami's staging profile
    expect(config.paused).toContain("paused-creek");
    expect(config.paused).toContain("paused-creek-staging");
    expect(config.paused).toContain("retired-creek");
    expect(config.paused).not.toContain("boulder-creek");
    // a retired kami gets no budget at all
    expect(config.budgets["retired-creek"]).toBeUndefined();
  });

  it("takes per-entity overrides from the config table", async () => {
    await setConfig(db, "gate.budgets", { default: { prompt_tokens_per_day: 500_000 }, "boulder-creek": { output_tokens_per_day: 90_000 } });
    await setConfig(db, "gate.concurrency", { per_entity: 3, queue: 12 });
    const config = await gateConfig(db);
    expect(config.budgets["boulder-creek"]!.output_tokens_per_day).toBe(90_000);
    expect(config.budgets["boulder-creek"]!.prompt_tokens_per_day).toBe(500_000);
    expect(config.budgets["left-hand-creek"]!.prompt_tokens_per_day).toBe(500_000);
    expect(config.concurrency).toEqual({ per_entity: 3, queue: 12 });
    await setConfig(db, "gate.budgets", {});
    await setConfig(db, "gate.concurrency", {});
  });

  it("renders a YAML file that parses back to the same config", async () => {
    const config = await gateConfig(db, { platform_url: "https://kami.test" });
    const yaml = renderGateYaml(config, new Date("2026-09-06T12:00:00Z"));
    expect(yaml.startsWith("# entity-gate configuration — GENERATED")).toBe(true);
    expect(yaml).toContain("# generated_at: 2026-09-06T12:00:00.000Z");
    expect(parseYaml(yaml)).toEqual(config);
    // no secret in the generated file (X.1)
    expect(yaml).not.toMatch(/kami_[a-z0-9-]+_[0-9a-f]{48}/);
  });

  it("keeps a retired kami in the paused set even when the DB row is the only trace", async () => {
    const config = await gateConfig(db, { staging: false });
    expect(config.budgets["retired-creek"]).toBeUndefined();
    expect(config.paused).toContain("retired-creek");
    expect(Object.keys(config.budgets).some((k) => k.endsWith("-staging"))).toBe(false);
  });
});

describe("no chain key may enter a profile", () => {
  it("refuses to render a voice block that looks like a key", async () => {
    const id = "entity/keyed";
    await db.insert(schema.entities).values({ id, slug: "keyed", name: "Keyed", archetype: "creek", bindingVersion: 1, soulVersion: 1, hermesProfile: "keyed" });
    await db.insert(schema.entityBindings).values({ entityId: id, bindingVersion: 1, binding: { anchor: "place/x" } as unknown as object, sha256: "b".repeat(64), review: "approved" });
    await db.insert(schema.souls).values({
      entityId: id,
      soulVersion: 1,
      hardRulesVersion: "1",
      voiceMd: `You speak plainly about 0x${"a".repeat(64)}.`,
      editedBy: "u-maya",
    });
    await expect(provisionEntity("keyed", db, { boxHost: null })).rejects.toMatchObject({ code: "chain_key" });
    // leave the row: the point is that nothing was written to a profile dir
    await db.update(schema.entities).set({ retiredAt: new Date() }).where(eq(schema.entities.id, id));
  });
});
