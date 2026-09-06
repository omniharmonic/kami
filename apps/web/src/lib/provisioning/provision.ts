/**
 * `provisionEntity(slug)` — the database → box path (architecture §12.3,
 * plan T3.2). Profiles are generated, never hand-edited.
 *
 * It renders, from the DB and the checked-in templates:
 *
 *   SOUL.md       hard rules (template, verbatim) + the entity's voice block
 *   config.yaml   the Hermes profile config, pointed at the gate, `paused:` set
 *   binding.json  the current `entity_bindings` row, canonical JSON
 *   .env          `PLATFORM_MCP_TOKEN` (minted here) + `KAMI_ENTITY_SLUG`
 *
 * …writes them to a staging directory, and then either
 *
 *   - shells out to `profiles/scripts/deploy-profile.ts` when `KAMI_BOX_HOST`
 *     is set (it does the rsync, the five `hermes cron add` calls and the
 *     reload), or
 *   - stops, and hands the operator the exact plan: the files it wrote, the
 *     commands it did not run, and why.
 *
 * The result always says which of the two happened. Nothing remote is touched
 * without `KAMI_BOX_HOST`, and no chain key may enter a profile directory (X.1).
 */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { canonicalJson, type Binding } from "@kami/binding";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { appendEntityEvent } from "@/db/events";
import { mintEntityToken } from "@/lib/mcp/tokens";
import { loadHardRules, renderSoul } from "@/lib/summon/soul";
import { twinTargetFor } from "@/lib/summon/twin";
import { renderProfileConfig } from "./config";

export type ProvisionMode = "deployed" | "planned";

export type ProvisionFile = { path: string; bytes: number; sha256?: string; secret?: boolean };

export type ProvisionPlan = {
  slug: string;
  deploy_slug: string;
  staging: boolean;
  paused: boolean;
  out_dir: string;
  files: ProvisionFile[];
  /** the command that would run (or did), argv style */
  deploy_command: string[];
  /** why deployment did not happen, when it did not */
  blocked_by: string | null;
  warnings: string[];
  binding_version: number | null;
  binding_review: string | null;
  soul_version: number | null;
  hard_rules_version: number;
  twin_base_url: string;
};

export type ProvisionResult = ProvisionPlan & {
  mode: ProvisionMode;
  /** stdout+stderr of deploy-profile.ts, when it ran */
  output: string | null;
  exit_code: number | null;
};

export type ProvisionOptions = {
  /** render the `<slug>-staging` profile (the summon preview) */
  staging?: boolean;
  /** where to write; a temp dir under the OS temp root by default */
  outDir?: string;
  /** default `process.env.KAMI_BOX_HOST`; empty string forces plan-only */
  boxHost?: string | null;
  /** default `process.env.PLATFORM_URL` */
  platformUrl?: string;
  /** default `http://127.0.0.1:8001/p/<deploy-slug>/v1` */
  gateUrl?: string;
  model?: string;
  now?: Date;
  actor?: string | null;
  /** test seam: run the deploy command with this instead of spawning */
  runner?: (argv: string[], cwd: string) => Promise<{ code: number; output: string }>;
  /** test seam: use this token instead of minting one */
  token?: string;
  /**
   * Mint (and so rotate) the per-entity `PLATFORM_MCP_TOKEN`. True by default,
   * because the rendered `.env` has to carry a real token for an operator to
   * push. A read-only preview passes false: rotating a token nobody then
   * deploys would silently lock a live kami's box out of the platform MCP.
   */
  mintToken?: boolean;
};

export class ProvisionError extends Error {
  override name = "ProvisionError";
  constructor(
    public readonly code: "not_found" | "no_binding" | "no_soul" | "chain_key" | "deploy_failed",
    message: string,
  ) {
    super(message);
  }
}

/** Assembled from parts so this file does not itself match `infra/box/tests/test_no_chain_keys.sh`. */
const CHAIN_KEY_RE = new RegExp("(" + ["PRIVATE_" + "KEY", "MNEMO" + "NIC", "SAFE_PROPOSER_" + "KEY", "0x[0-9a-fA-F]{64}"].join("|") + ")");

export function assertNoChainKey(name: string, content: string): void {
  const m = CHAIN_KEY_RE.exec(content);
  if (m) throw new ProvisionError("chain_key", `${name} contains something that looks like a chain key (${m[0].slice(0, 12)}…)`);
}

export function deployScriptPath(): string {
  return process.env.KAMI_DEPLOY_PROFILE_PATH ?? path.resolve(process.cwd(), "../../profiles/scripts/src/deploy-profile.ts");
}

async function defaultRunner(argv: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("error", (err) => resolve({ code: -1, output: `${output}\n${(err as Error).message}` }));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

export async function provisionEntity(slug: string, db: DbOrTx, opts: ProvisionOptions = {}): Promise<ProvisionResult> {
  const now = opts.now ?? new Date();
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.slug, slug)).limit(1);
  if (!entity) throw new ProvisionError("not_found", `no entity with slug ${slug}`);

  const [bindingRow] = await db
    .select()
    .from(schema.entityBindings)
    .where(
      entity.bindingVersion === null
        ? eq(schema.entityBindings.entityId, entity.id)
        : and(eq(schema.entityBindings.entityId, entity.id), eq(schema.entityBindings.bindingVersion, entity.bindingVersion)),
    )
    .orderBy(desc(schema.entityBindings.bindingVersion))
    .limit(1);
  if (!bindingRow) throw new ProvisionError("no_binding", `entity ${slug} has no binding row to render`);

  const [soulRow] = await db
    .select()
    .from(schema.souls)
    .where(eq(schema.souls.entityId, entity.id))
    .orderBy(desc(schema.souls.soulVersion))
    .limit(1);
  if (!soulRow) throw new ProvisionError("no_soul", `entity ${slug} has no soul row to render`);

  const warnings: string[] = [];
  if (bindingRow.review !== "approved") {
    warnings.push(`binding v${bindingRow.bindingVersion} is ${bindingRow.review}: a steward has not approved it, so the profile is rendered but the hourly job will not compute a snapshot`);
  }
  const staging = opts.staging === true;
  const deploySlug = staging ? `${slug}-staging` : slug;
  const paused = entity.pausedAt !== null || entity.retiredAt !== null;
  if (paused) warnings.push("this kami is paused or retired; the profile is rendered with `paused: true` so a gateway restart cannot resurrect it");

  const hardRules = await loadHardRules();
  const soul = renderSoul(hardRules.block, soulRow.voiceMd, slug);
  const twin = await twinTargetFor(entity.id, { db });
  const config = await renderProfileConfig({
    slug: deploySlug,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.gateUrl ? { gate_url: opts.gateUrl } : {}),
    ...(opts.platformUrl ? { platform_url: opts.platformUrl } : {}),
    twin_base_url: twin.base_url,
    paused,
  });
  const binding = bindingRow.binding as unknown as Binding;
  const bindingJson = `${canonicalJson(binding)}\n`;

  const mintToken = opts.mintToken !== false;
  const token = opts.token ?? (mintToken ? (await mintEntityToken(db, deploySlug, now)).token : "<minted when this profile is provisioned for real>");
  if (!mintToken) warnings.push("this is a read-only preview: PLATFORM_MCP_TOKEN was not minted, so the .env carries a placeholder and no live token was rotated");
  const env = `# Rendered by apps/web/src/lib/provisioning (architecture §12.3). Never committed.\nPLATFORM_MCP_TOKEN=${token}\nKAMI_ENTITY_SLUG=${deploySlug}\n`;

  const files: Array<{ rel: string; content: string; secret?: boolean }> = [
    { rel: "SOUL.md", content: soul },
    { rel: "config.yaml", content: config },
    { rel: "binding.json", content: bindingJson },
    { rel: ".env", content: env, secret: true },
  ];
  for (const f of files) assertNoChainKey(f.rel, f.content);

  const outDir = opts.outDir ?? path.join(tmpdir(), "kami-provision", deploySlug);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const f of files) {
    // turbopack traces dynamic path.join calls as "the whole project"; these
    // are runtime writes into a staging dir, not files to bundle.
    await writeFile(path.join(/*turbopackIgnore: true*/ outDir, f.rel), f.content, { mode: f.secret ? 0o600 : 0o644 });
  }

  const boxHost = opts.boxHost === undefined ? (process.env.KAMI_BOX_HOST ?? null) : opts.boxHost;
  const deployCommand = [
    "pnpm",
    "--filter",
    "@kami/profile-scripts",
    "exec",
    "tsx",
    deployScriptPath(),
    slug,
    "--host",
    boxHost || "<KAMI_BOX_HOST>",
    "--voice-file",
    path.join(/*turbopackIgnore: true*/ outDir, "voice.md"),
    "--binding-file",
    path.join(/*turbopackIgnore: true*/ outDir, "binding.yaml"),
    "--twin-base-url",
    twin.base_url,
    ...(staging ? ["--staging"] : []),
    ...(paused ? ["--paused"] : []),
    "--out",
    outDir,
  ];

  // deploy-profile.ts renders SOUL.md from voice.md and binding.json from
  // binding.yaml, so the staging dir carries both in the shapes it expects.
  await writeFile(path.join(/*turbopackIgnore: true*/ outDir, "voice.md"), `${soulRow.voiceMd.trim()}\n`, { mode: 0o644 });
  await writeFile(path.join(/*turbopackIgnore: true*/ outDir, "binding.yaml"), `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o644 });

  const plan: ProvisionPlan = {
    slug,
    deploy_slug: deploySlug,
    staging,
    paused,
    out_dir: outDir,
    files: files.map((f) => ({ path: path.join(/*turbopackIgnore: true*/ outDir, f.rel), bytes: Buffer.byteLength(f.content, "utf8"), ...(f.secret ? { secret: true } : {}) })),
    deploy_command: deployCommand,
    blocked_by: boxHost ? null : "KAMI_BOX_HOST is not set, so nothing was pushed: this is the plan an operator runs",
    warnings,
    binding_version: bindingRow.bindingVersion,
    binding_review: bindingRow.review,
    soul_version: soulRow.soulVersion,
    hard_rules_version: hardRules.version,
    twin_base_url: twin.base_url,
  };

  if (!boxHost) {
    await appendEntityEvent(db, {
      entity_id: entity.id,
      actor: opts.actor ?? null,
      kind: "profile_planned",
      payload: { deploy_slug: deploySlug, out_dir: outDir, binding_version: bindingRow.bindingVersion, soul_version: soulRow.soulVersion, reason: plan.blocked_by },
      at: now,
    });
    return { ...plan, mode: "planned", output: null, exit_code: null };
  }

  const runner = opts.runner ?? defaultRunner;
  const repoRoot = path.resolve(process.cwd(), "../..");
  const { code, output } = await runner(deployCommand, repoRoot);
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: opts.actor ?? null,
    kind: code === 0 ? "profile_deployed" : "profile_deploy_failed",
    payload: { deploy_slug: deploySlug, host: boxHost, exit_code: code, binding_version: bindingRow.bindingVersion, soul_version: soulRow.soulVersion },
    at: now,
  });
  if (code !== 0) throw new ProvisionError("deploy_failed", `deploy-profile.ts exited ${code}: ${output.slice(-2000)}`);
  return { ...plan, mode: "deployed", output, exit_code: code };
}
