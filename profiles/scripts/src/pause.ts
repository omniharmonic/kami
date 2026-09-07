#!/usr/bin/env tsx
/**
 * pause.ts <slug> [--resume --guardians <a>,<b>] [--reason "<text>"] [--dry-run]
 *
 * Pause: POST the gate's admin endpoint (GATE_ADMIN_URL + X-Gate-Admin secret), call the platform pause
 * action when PLATFORM_URL is set, print verified per-job Hermes CLI instructions, and drop a
 * profiles/<slug>/state/paused marker so the next deploy keeps the profile paused (architecture §5.9).
 * One guardian pauses. Resume needs two distinct guardian names (ADR-E12, §15 deviation).
 *
 * Env: GATE_ADMIN_URL (default http://127.0.0.1:8001), GATE_ADMIN_SECRET, PLATFORM_URL, PLATFORM_ADMIN_TOKEN,
 *      Hermes cron instructions must be run on the dedicated runtime host.
 * Exit: 0 ok · 1 gate refused/unreachable · 2 usage.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { profileDir } from "./lib/paths.js";

export class UsageError extends Error {
  override name = "UsageError";
}

export type PauseArgs = {
  slug: string;
  resume: boolean;
  guardians: string[];
  reason: string;
  dryRun: boolean;
};

export function parsePauseArgs(argv: string[]): PauseArgs {
  const [slug, ...rest] = argv;
  if (!slug || slug.startsWith("-") || !/^[a-z0-9-]+$/.test(slug)) {
    throw new UsageError("usage: pause.ts <slug> [--resume --guardians a,b] [--reason text] [--dry-run]");
  }
  const a: PauseArgs = { slug, resume: false, guardians: [], reason: "", dryRun: false };
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i]!;
    const val = (): string => {
      const v = rest[++i];
      if (v === undefined) throw new UsageError(`${f} needs a value`);
      return v;
    };
    switch (f) {
      case "--resume": a.resume = true; break;
      case "--dry-run": a.dryRun = true; break;
      case "--guardians": a.guardians = val().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--reason": a.reason = val(); break;
      default: throw new UsageError(`unknown flag ${f}`);
    }
  }
  validateGuardians(a);
  return a;
}

/** One guardian can pause; resuming needs two distinct names. */
export function validateGuardians(a: Pick<PauseArgs, "resume" | "guardians">): void {
  const distinct = new Set(a.guardians.map((g) => g.toLowerCase()));
  if (a.resume && distinct.size < 2) {
    throw new UsageError("resume requires two distinct guardian names: --guardians <a>,<b> (ADR-E12)");
  }
}

export type PauseDeps = {
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  now: () => Date;
  stateDir: string;
};

export type PauseResult = { gate: number | "skipped"; platform: number | "skipped"; hermesCommand: string };

export async function runPause(a: PauseArgs, deps: PauseDeps): Promise<PauseResult> {
  const at = deps.now().toISOString();
  const body = JSON.stringify({ guardians: a.guardians, reason: a.reason, at, action: a.resume ? "resume" : "pause" });
  const gateBase = (deps.env.GATE_ADMIN_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
  const gateSecret = deps.env.GATE_ADMIN_SECRET ?? "";
  const gateUrl = `${gateBase}/admin/pause/${a.slug}`; // verify against apps/gate: POST pauses, DELETE resumes
  const gateMethod = a.resume ? "DELETE" : "POST";

  // Installed Hermes manages jobs by ID, never by profile-wide /api/jobs/pause.
  // These are review instructions, not an executed bulk mutation.
  const hermesCommand =
    `hermes --profile '${a.slug}' cron list --all\n` +
    `# Inspect each job's profile and ID, then run for each matching job:\n` +
    `hermes --profile '${a.slug}' cron ${a.resume ? "resume" : "pause"} '<verified-job-id>'`;


  const result: PauseResult = { gate: "skipped", platform: "skipped", hermesCommand };

  deps.log(`# ${a.resume ? "RESUME" : "PAUSE"} ${a.slug} by [${a.guardians.join(", ")}] at ${at}${a.reason ? ` — ${a.reason}` : ""}`);
  deps.log(`# 1. gate: ${gateMethod} ${gateUrl} (X-Gate-Admin)`);
  if (!a.dryRun) {
    const r = await deps.fetch(gateUrl, {
      method: gateMethod,
      headers: { "X-Gate-Admin": gateSecret, "Content-Type": "application/json" },
      body,
    });
    result.gate = r.status;
    if (!r.ok) throw new Error(`gate answered ${r.status} — the entity is NOT ${a.resume ? "resumed" : "paused"} at the gate`);
    deps.log(`   gate → ${r.status}`);
  }

  const platform = deps.env.PLATFORM_URL?.replace(/\/$/, "");
  if (platform) {
    const url = `${platform}/api/entities/${a.slug}/pause`; // verify against apps/web: the pause action route
    deps.log(`# 2. platform: POST ${url}`);
    if (!a.dryRun) {
      const r = await deps.fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${deps.env.PLATFORM_ADMIN_TOKEN ?? ""}`, "Content-Type": "application/json" },
        body,
      });
      result.platform = r.status;
      deps.log(`   platform → ${r.status}${r.ok ? "" : " (not ok — pause_events row may be missing; check /admin)"}`);
    }
  } else {
    deps.log("# 2. platform: PLATFORM_URL unset — skipped (phase 0)");
  }

  deps.log("# 3. Hermes cron (run on the box; printed, not executed):");
  deps.log(`   ${hermesCommand}`);

  const marker = path.join(deps.stateDir, "paused");
  if (!a.dryRun) {
    if (a.resume) {
      fs.rmSync(marker, { force: true });
    } else {
      fs.mkdirSync(deps.stateDir, { recursive: true });
      fs.writeFileSync(marker, `${at} ${a.guardians.join(",")} ${a.reason}\n`);
    }
  }
  deps.log(`# 4. ${a.dryRun ? "dry-run: would " : ""}${a.resume ? "remove" : "write"}${a.dryRun ? "" : (a.resume ? "d" : "")} ${marker} — deploy-profile ${a.resume ? "will no longer" : "will"} write paused: true`);
  return result;
}

export async function main(argv: string[]): Promise<number> {
  let args: PauseArgs;
  try {
    args = parsePauseArgs(argv);
  } catch (e) {
    console.error(`pause: ${(e as Error).message}`);
    return 2;
  }
  try {
    await runPause(args, {
      fetch,
      env: process.env,
      log: (l) => console.log(l),
      now: () => new Date(),
      stateDir: path.join(profileDir(args.slug), "state"),
    });
    return 0;
  } catch (e) {
    console.error(`pause: ${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
