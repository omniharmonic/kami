#!/usr/bin/env tsx
/**
 * pause-drill.ts <slug> [--gate-url http://127.0.0.1:8001] [--timeout-s 90] [--out docs/drills]
 *                       [--operator <name>] [--resume-guardians a,b]
 *
 * Runs pause.ts, measures the time until the gate returns 423 for /p/<slug>/v1/chat/completions, optionally
 * checks the platform chat route, writes docs/drills/<date>.md in the public drill-log format (rendered on
 * "how I work"), and — only when two guardians are named — resumes at the end. Architecture §5.9: quarterly.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, profileDir } from "./lib/paths.js";
import { runPause } from "./pause.js";

export type DrillResult = {
  slug: string;
  startedAt: string;
  operator: string;
  gateMs: number | null;
  platformMs: number | null | "not checked";
  timeoutS: number;
  resumedBy: string[] | null;
  notes: string[];
};

export const TARGET_MS = 60_000; // "within 60 s" (T1.11 done-when; §5.9 one gateway tick)

export function drillReport(r: DrillResult): string {
  const pass = r.gateMs !== null && r.gateMs <= TARGET_MS;
  const fmt = (ms: number | null | "not checked"): string =>
    ms === "not checked" ? "not checked" : ms === null ? `no 423 within ${r.timeoutS} s` : `${ms} ms`;
  return [
    `# Pause drill — ${r.startedAt.slice(0, 10)}`,
    "",
    `A guardian pause must stop chat, cron and proposals within ${TARGET_MS / 1000} s. This log is public on "how I work".`,
    "",
    `- Entity: \`${r.slug}\``,
    `- Started (UTC): ${r.startedAt}`,
    `- Initiated by: ${r.operator}`,
    `- Gate returned 423 after: ${fmt(r.gateMs)} (target ≤ ${TARGET_MS} ms)`,
    `- Platform chat route returned 423 after: ${fmt(r.platformMs)}`,
    `- Hermes jobs paused: verify by hand — \`hermes cron list --profile ${r.slug}\` (*verify* the command)`,
    `- Resumed: ${r.resumedBy ? `by ${r.resumedBy.join(" and ")} (two guardians)` : "left paused; resume needs two guardians"}`,
    `- Result: **${pass ? "PASS" : "FAIL"}**`,
    ...(r.notes.length ? ["- Notes:", ...r.notes.map((n) => `  - ${n}`)] : []),
    "",
  ].join("\n");
}

async function pollUntil423(url: string, timeoutS: number, fetchFn: typeof fetch, headers: Record<string, string>): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) {
    try {
      const r = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ model: "probe", messages: [{ role: "user", content: "drill" }], max_tokens: 1, stream: false }),
      });
      if (r.status === 423) return Date.now() - t0;
    } catch {
      /* gate not up yet or transient; keep polling */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
}

export async function main(argv: string[]): Promise<number> {
  const [slug, ...rest] = argv;
  if (!slug || slug.startsWith("-")) {
    console.error("usage: pause-drill.ts <slug> [--gate-url url] [--timeout-s 90] [--out dir] [--operator name] [--resume-guardians a,b]");
    return 2;
  }
  let gateUrl = process.env.GATE_URL ?? "http://127.0.0.1:8001";
  let timeoutS = 90;
  let out = path.join(REPO_ROOT, "docs", "drills");
  let operator = process.env.USER ?? "operator";
  let resumeGuardians: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i]!;
    const v = rest[i + 1];
    if (f === "--gate-url" && v) { gateUrl = v; i++; }
    else if (f === "--timeout-s" && v) { timeoutS = Number(v); i++; }
    else if (f === "--out" && v) { out = v; i++; }
    else if (f === "--operator" && v) { operator = v; i++; }
    else if (f === "--resume-guardians" && v) { resumeGuardians = v.split(",").map((s) => s.trim()).filter(Boolean); i++; }
    else { console.error(`unknown flag ${f}`); return 2; }
  }

  const startedAt = new Date().toISOString();
  const notes: string[] = [];
  const stateDir = path.join(profileDir(slug), "state");
  const deps = { fetch, env: process.env, log: (l: string) => console.log(l), now: () => new Date(), stateDir };

  const t0 = Date.now();
  try {
    await runPause({ slug, resume: false, guardians: [operator], reason: "quarterly pause drill", dryRun: false }, deps);
  } catch (e) {
    notes.push(`pause.ts failed: ${(e as Error).message}`);
  }
  const gateMs = await pollUntil423(`${gateUrl.replace(/\/$/, "")}/p/${slug}/v1/chat/completions`, timeoutS, fetch, {});
  if (gateMs !== null) notes.push(`pause.ts returned after ${Date.now() - t0 - gateMs} ms; gate 423 observed ${gateMs} ms later`);

  let platformMs: number | null | "not checked" = "not checked";
  const platform = process.env.PLATFORM_URL?.replace(/\/$/, "");
  if (platform) platformMs = await pollUntil423(`${platform}/e/${slug}/chat`, timeoutS, fetch, {});

  let resumedBy: string[] | null = null;
  if (resumeGuardians.length >= 2) {
    try {
      await runPause({ slug, resume: true, guardians: resumeGuardians, reason: "drill complete", dryRun: false }, deps);
      resumedBy = resumeGuardians;
    } catch (e) {
      notes.push(`resume failed: ${(e as Error).message}`);
    }
  }

  const report = drillReport({ slug, startedAt, operator, gateMs, platformMs, timeoutS, resumedBy, notes });
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${startedAt.slice(0, 10)}.md`);
  fs.writeFileSync(file, report);
  console.log(report);
  console.log(`# written ${file}`);
  return gateMs !== null && gateMs <= TARGET_MS ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
