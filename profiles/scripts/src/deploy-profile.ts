#!/usr/bin/env tsx
/**
 * deploy-profile.ts <slug> [--dry-run] [--host <tailscale host>] [--staging] [--paused] [--voice-file <path>]
 *                   [--model <name>] [--large-model <name>] [--gate-url <url>] [--platform-url <url>]
 *                   [--twin-base-url <url>] [--remote-hermes-home <dir>] [--hermes-cmd "<cmd>"] [--out <dir>]
 *
 * Renders SOUL.md (hard rules from the template + voice from profiles/<slug>/voice.md), config.yaml, .env,
 * binding.json (from profiles/<slug>/binding.yaml), copies the entity-steward skill, writes `paused: true`
 * when --paused or profiles/<slug>/state/paused exists, pushes over Tailscale with rsync, then runs the
 * compatible scheduler commands. Unsupported runtime features block before rsync.
 * --dry-run prints all compatibility blockers and writes nothing remote.
 *
 * Env: PLATFORM_MCP_TOKEN (required unless --dry-run), PLATFORM_URL, TWIN_BASE_URL, BOX_HOST, HERMES_CMD,
 *      REMOTE_HERMES_HOME (default /opt/data — the path inside the hermes container, see infra/box).
 *
 * Architecture §12.3, §5.9; plan T0.7, T1.11, T3.2. Everything about the Hermes CLI is *verify*.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { renderSoul } from "./lib/soul.js";
import { assertNoChainKey, bindingYamlToJson, renderConfig, renderEnv } from "./lib/config.js";
import { cronCommands, cronCompatibilityIssues, parseCronSpec } from "./lib/cron.js";
import {
  CONFIG_TMPL_PATH,
  CRON_YAML_PATH,
  ENV_TMPL_PATH,
  HARD_RULES_PATH,
  PROFILES_DIR,
  SKILL_DIR,
  profileDir,
} from "./lib/paths.js";

export type DeployOptions = {
  slug: string;
  dryRun?: boolean;
  staging?: boolean;
  paused?: boolean;
  host?: string | undefined;
  voiceFile?: string | undefined;
  bindingFile?: string | undefined;
  stateDir?: string | undefined;
  outDir?: string | undefined;
  model?: string | undefined;
  largeModel?: string | undefined;
  gateUrl?: string | undefined;
  platformUrl?: string | undefined;
  twinBaseUrl?: string | undefined;
  platformMcpToken?: string | undefined;
  remoteHermesHome?: string | undefined;
  hermesCmd?: string | undefined;
};

export type DeployPlan = {
  slug: string;
  deploySlug: string;
  paused: boolean;
  compatibilityBlockers: string[];
  /** relative path inside the profile dir → content */
  files: Map<string, string>;
  /** directories copied verbatim: local absolute → relative inside the profile dir */
  copies: Array<{ from: string; to: string }>;
  warnings: string[];
  remoteProfileDir: string;
  rsyncCommand: string[];
  remoteCommands: string[];
};

export const DEFAULTS = {
  model: "qwen3.5-9b",
  twinBaseUrl: "https://data.bioregionaltwin.org",
  platformUrl: "http://127.0.0.1:3000",
  remoteHermesHome: "/opt/data",
  hermesCmd: "docker compose -f /opt/kami/infra/box/docker-compose.yml exec -T hermes hermes",
  host: "box",
};

export function isPausedByState(stateDir: string): boolean {
  return fs.existsSync(path.join(stateDir, "paused"));
}

export function buildPlan(o: DeployOptions): DeployPlan {
  if (!/^[a-z0-9-]+$/.test(o.slug)) throw new Error(`slug must match ^[a-z0-9-]+$, got '${o.slug}'`);
  const deploySlug = o.staging ? `${o.slug}-staging` : o.slug;
  const dir = profileDir(o.slug);
  const stateDir = o.stateDir ?? path.join(dir, "state");
  const paused = Boolean(o.paused) || isPausedByState(stateDir);
  const warnings: string[] = [];

  const voicePath = o.voiceFile ?? path.join(dir, "voice.md");
  if (!fs.existsSync(voicePath)) throw new Error(`no voice block at ${voicePath} (profiles/<slug>/voice.md or --voice-file)`);
  const soul = renderSoul(fs.readFileSync(HARD_RULES_PATH, "utf8"), fs.readFileSync(voicePath, "utf8"), o.slug);

  const model = o.model ?? DEFAULTS.model;
  const config = renderConfig(fs.readFileSync(CONFIG_TMPL_PATH, "utf8"), {
    slug: deploySlug,
    model,
    gate_url: o.gateUrl ?? `http://127.0.0.1:8001/p/${deploySlug}/v1`,
    platform_url: (o.platformUrl ?? process.env.PLATFORM_URL ?? DEFAULTS.platformUrl).replace(/\/$/, ""),
    twin_base_url: (o.twinBaseUrl ?? process.env.TWIN_BASE_URL ?? DEFAULTS.twinBaseUrl).replace(/\/$/, ""),
    paused,
  });

  const token = o.platformMcpToken ?? process.env.PLATFORM_MCP_TOKEN ?? "";
  if (!token && !o.dryRun) throw new Error("PLATFORM_MCP_TOKEN is required (per-entity, scoped; architecture §10.2)");
  const env = renderEnv(fs.readFileSync(ENV_TMPL_PATH, "utf8"), deploySlug, token || "<PLATFORM_MCP_TOKEN>");

  const files = new Map<string, string>([
    ["SOUL.md", soul],
    ["config.yaml", config],
    [".env", env],
  ]);

  const bindingPath = o.bindingFile ?? path.join(dir, "binding.yaml");
  if (fs.existsSync(bindingPath)) {
    files.set("binding.json", bindingYamlToJson(fs.readFileSync(bindingPath, "utf8")));
  } else {
    const msg = `no binding at ${bindingPath}; binding.json will not be rendered (binding.yaml is owned by the binding package)`;
    if (!o.dryRun) throw new Error(msg);
    warnings.push(msg);
  }
  if (paused) files.set("state/paused", `paused\n`);

  for (const [name, content] of files) assertNoChainKey(name, content);

  const remoteHermesHome = o.remoteHermesHome ?? process.env.REMOTE_HERMES_HOME ?? DEFAULTS.remoteHermesHome;
  const remoteProfileDir = `${remoteHermesHome}/profiles/${deploySlug}`;
  const hermesCmd = o.hermesCmd ?? process.env.HERMES_CMD ?? DEFAULTS.hermesCmd;
  const cronSpec = parseCronSpec(fs.readFileSync(CRON_YAML_PATH, "utf8"));
  const compatibilityBlockers = [
    ...cronCompatibilityIssues(cronSpec),
    "Runtime profile routing and evidence forwarding require an adapter; stock Hermes has neither /p/<slug> routing nor the gate toolcalls event",
    ...(paused ? ["Existing scheduler jobs must be verified paused by job ID before any profile replacement"] : []),
  ];
  if (!o.dryRun && compatibilityBlockers.length) {
    throw new Error(`Runtime deployment blocked before file transfer: ${compatibilityBlockers.join("; ")}`);
  }
  const crons = compatibilityBlockers.length ? [] : cronCommands(cronSpec, { slug: deploySlug, remoteProfileDir, hermesCmd, largeModel: o.largeModel, paused });

  const host = o.host ?? process.env.BOX_HOST ?? DEFAULTS.host;
  const outDir = o.outDir ?? path.join(stateDir, "build", deploySlug);
  // ~/.hermes on the host is mounted at /opt/data in the container; rsync targets the host path.
  const hostProfileDir = `~/.hermes/profiles/${deploySlug}`;
  const rsyncCommand = [
    "rsync", "-az", "--chmod=D700,F600", "--exclude", "state/", "--exclude", "MEMORY.md",
    `${outDir}/`, `${host}:${hostProfileDir}/`,
  ];
  const remoteCommands = [
    `mkdir -p ${hostProfileDir}/state`,
    ...(paused ? [`touch ${hostProfileDir}/state/paused`] : [`rm -f ${hostProfileDir}/state/paused`]),
    `chmod 700 ${hostProfileDir}/skills/entity-steward/scripts/pulse_precheck.py`,
    ...crons,
    `${hermesCmd} --profile '${deploySlug}' cron list --all`,
  ];

  return {
    slug: o.slug,
    deploySlug,
    paused,
    compatibilityBlockers,
    files,
    copies: [{ from: SKILL_DIR, to: "skills/entity-steward" }],
    warnings,
    remoteProfileDir,
    rsyncCommand,
    remoteCommands,
  };
}

export function writeBuild(plan: DeployPlan, outDir: string): void {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const [rel, content] of plan.files) {
    const p = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, { mode: 0o600 });
  }
  for (const c of plan.copies) {
    fs.cpSync(c.from, path.join(outDir, c.to), { recursive: true });
  }
}

function run(cmd: string[], dryRun: boolean): void {
  console.log(`$ ${cmd.join(" ")}`);
  if (dryRun) return;
  const r = spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`command failed (${r.status}): ${cmd.join(" ")}`);
}

export function parseArgs(argv: string[]): DeployOptions {
  const [slug, ...rest] = argv;
  if (!slug || slug.startsWith("-")) throw new Error("usage: deploy-profile.ts <slug> [--dry-run] [--host box] [--staging] [--paused] …");
  const o: DeployOptions = { slug };
  const take = (i: number): string => {
    const v = rest[i + 1];
    if (v === undefined) throw new Error(`${rest[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    switch (a) {
      case "--dry-run": o.dryRun = true; break;
      case "--staging": o.staging = true; break;
      case "--paused": o.paused = true; break;
      case "--host": o.host = take(i++); break;
      case "--voice-file": o.voiceFile = take(i++); break;
      case "--binding-file": o.bindingFile = take(i++); break;
      case "--model": o.model = take(i++); break;
      case "--large-model": o.largeModel = take(i++); break;
      case "--gate-url": o.gateUrl = take(i++); break;
      case "--platform-url": o.platformUrl = take(i++); break;
      case "--twin-base-url": o.twinBaseUrl = take(i++); break;
      case "--remote-hermes-home": o.remoteHermesHome = take(i++); break;
      case "--hermes-cmd": o.hermesCmd = take(i++); break;
      case "--out": o.outDir = take(i++); break;
      default: throw new Error(`unknown flag ${a}`);
    }
  }
  return o;
}

export function main(argv: string[]): number {
  const o = parseArgs(argv);
  const plan = buildPlan(o);
  const dryRun = Boolean(o.dryRun);
  const outDir = o.outDir ?? path.join(o.stateDir ?? path.join(profileDir(o.slug), "state"), "build", plan.deploySlug);

  console.log(`# deploy-profile ${plan.slug} → ${plan.deploySlug}${plan.paused ? " (PAUSED)" : ""}${dryRun ? " [dry-run]" : ""}`);
  for (const blocker of plan.compatibilityBlockers) console.log(`! runtime blocked: ${blocker}`);
  for (const w of plan.warnings) console.log(`! ${w}`);
  console.log(`# files → ${outDir}`);
  for (const [rel, content] of plan.files) console.log(`  ${rel}  (${content.length} bytes)`);
  for (const c of plan.copies) console.log(`  ${c.to}/  (copied from ${path.relative(PROFILES_DIR, c.from)})`);
  writeBuild(plan, outDir);

  console.log("# push (rsync over Tailscale)");
  run(plan.rsyncCommand, dryRun);
  console.log("# remote (ssh) — review only until runtime blockers are resolved");
  for (const c of plan.remoteCommands) run(["ssh", plan.rsyncCommand.at(-1)!.split(":")[0]!, c], dryRun);
  console.log(dryRun ? "# dry-run: nothing pushed" : "# done; check the pulse skipped/woke counter within the hour (§12.5 step 7)");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`deploy-profile: ${(e as Error).message}`);
    process.exit(1);
  }
}
