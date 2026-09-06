#!/usr/bin/env tsx
/**
 * provision-entity.ts <slug> [--staging] [--deploy] [--platform <url>] [--token <admin token>]
 *                     [--out <dir>] [--host <box>] [--print]
 *
 * The CLI half of `apps/web/src/lib/provisioning` (architecture §12.3, plan
 * T3.2). The database lives behind the platform, so this script does not talk
 * to Postgres: it asks the platform for the rendered profile
 * (`GET /api/admin/profiles?slug=…`), writes the files it names into a
 * staging directory, and then calls `deploy-profile.ts` — the existing
 * script, unchanged — to push them and add the cron jobs.
 *
 * Without `--deploy` (or without BOX_HOST/KAMI_BOX_HOST) it prints the plan
 * and writes nothing remote. That is the normal case, and it is the honest
 * one: an operator sees exactly what would be pushed before it is.
 *
 * Env: PLATFORM_URL (default http://127.0.0.1:3000), PLATFORM_ADMIN_TOKEN,
 *      BOX_HOST / KAMI_BOX_HOST.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { main as deployProfileMain } from "./deploy-profile.js";

export type ProvisionArgs = {
  slug: string;
  staging: boolean;
  deploy: boolean;
  platform: string;
  token: string | undefined;
  outDir: string | undefined;
  host: string | undefined;
  print: boolean;
};

export type PlatformFile = { path: string; bytes: number; secret?: boolean };
export type PlatformPlan = {
  slug: string;
  deploy_slug: string;
  staging: boolean;
  paused: boolean;
  out_dir: string;
  files: PlatformFile[];
  deploy_command: string[];
  blocked_by: string | null;
  warnings: string[];
  binding_version: number | null;
  binding_review: string | null;
  soul_version: number | null;
  hard_rules_version: number;
  twin_base_url: string;
  mode: "planned" | "deployed";
};

export function parseArgs(argv: string[]): ProvisionArgs {
  const [slug, ...rest] = argv;
  if (!slug || slug.startsWith("-")) {
    throw new Error("usage: provision-entity.ts <slug> [--staging] [--deploy] [--platform <url>] [--token <t>] [--out <dir>] [--host <box>] [--print]");
  }
  const args: ProvisionArgs = {
    slug,
    staging: false,
    deploy: false,
    platform: (process.env.PLATFORM_URL ?? "http://127.0.0.1:3000").replace(/\/$/, ""),
    token: process.env.PLATFORM_ADMIN_TOKEN,
    outDir: undefined,
    host: process.env.KAMI_BOX_HOST ?? process.env.BOX_HOST,
    print: false,
  };
  const take = (i: number): string => {
    const v = rest[i + 1];
    if (v === undefined) throw new Error(`${rest[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    switch (a) {
      case "--staging": args.staging = true; break;
      case "--deploy": args.deploy = true; break;
      case "--print": args.print = true; break;
      case "--platform": args.platform = take(i++).replace(/\/$/, ""); break;
      case "--token": args.token = take(i++); break;
      case "--out": args.outDir = take(i++); break;
      case "--host": args.host = take(i++); break;
      default: throw new Error(`unknown flag ${a}`);
    }
  }
  return args;
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Ask the platform to render the profile. Never deploys: `--deploy` is this script's job. */
export async function fetchPlan(args: ProvisionArgs, fetchImpl: Fetcher = fetch as unknown as Fetcher): Promise<PlatformPlan> {
  const url = `${args.platform}/api/admin/profiles?slug=${encodeURIComponent(args.slug)}${args.staging ? "&staging=1" : ""}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (args.token) headers.authorization = `Bearer ${args.token}`;
  const res = await fetchImpl(url, { method: "GET", headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
    throw new Error(`platform answered ${res.status}${body.reason ? ` (${body.reason}${body.message ? `: ${body.message}` : ""})` : ""}`);
  }
  return (await res.json()) as PlatformPlan;
}

export function describePlan(plan: PlatformPlan, args: ProvisionArgs): string[] {
  const lines: string[] = [];
  lines.push(`# provision ${plan.slug} → ${plan.deploy_slug}${plan.paused ? " (PAUSED)" : ""}`);
  lines.push(`# twin:    ${plan.twin_base_url}`);
  lines.push(`# binding: v${plan.binding_version ?? "?"} (${plan.binding_review ?? "?"})   soul: v${plan.soul_version ?? "?"}   hard rules: v${plan.hard_rules_version}`);
  for (const w of plan.warnings) lines.push(`! ${w}`);
  lines.push(`# files rendered by the platform into ${plan.out_dir}:`);
  for (const f of plan.files) lines.push(`    ${path.basename(f.path)}  (${f.bytes} bytes)${f.secret ? "  [mode 600, not printed]" : ""}`);
  if (!args.deploy) {
    lines.push("# --deploy was not given, so nothing was pushed. To deploy:");
    lines.push(`    pnpm --filter @kami/profile-scripts exec tsx src/provision-entity.ts ${plan.slug}${plan.staging ? " --staging" : ""} --deploy --host <box>`);
  } else if (!args.host) {
    lines.push("# no box host (--host, KAMI_BOX_HOST or BOX_HOST), so nothing was pushed.");
  }
  return lines;
}

export async function main(argv: string[], deps: { fetchImpl?: Fetcher; deploy?: (a: string[]) => number; log?: (l: string) => void } = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const args = parseArgs(argv);
  const plan = await fetchPlan(args, deps.fetchImpl);
  for (const line of describePlan(plan, args)) log(line);

  if (args.print) {
    for (const f of plan.files) {
      if (f.secret) continue;
      if (!fs.existsSync(f.path)) continue;
      log(`\n----- ${path.basename(f.path)} -----`);
      log(fs.readFileSync(f.path, "utf8"));
    }
  }

  if (!args.deploy) return 0;
  if (!args.host) {
    log("! refusing to deploy without a box host");
    return 1;
  }
  // The platform wrote voice.md and binding.yaml into the staging directory in
  // the shapes deploy-profile.ts expects; hand it those, unchanged.
  const deployArgv = [
    plan.slug,
    "--host", args.host,
    "--voice-file", path.join(plan.out_dir, "voice.md"),
    "--binding-file", path.join(plan.out_dir, "binding.yaml"),
    "--twin-base-url", plan.twin_base_url,
    "--out", args.outDir ?? plan.out_dir,
    ...(plan.staging ? ["--staging"] : []),
    ...(plan.paused ? ["--paused"] : []),
  ];
  log(`# handing off to deploy-profile.ts ${deployArgv.join(" ")}`);
  const run = deps.deploy ?? deployProfileMain;
  return run(deployArgv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(`provision-entity: ${(e as Error).message}`);
      process.exit(1);
    });
}
