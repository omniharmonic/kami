/**
 * cron.yaml → `hermes cron add` commands. The flag names are the PLAN from profiles/templates/cron.yaml's
 * header comment — *verify* against `hermes cron add --help` on v0.21.0 (docs/verify.md #1).
 */
import { parse as parseYaml } from "yaml";

export type CronJob = {
  name: string;
  schedule: string;
  prompt: string;
  timezone?: string;
  pre_script?: string;
  toolsets?: string[];
  continuity?: boolean;
  context_from?: string[];
  skill?: string;
  reasoning_effort?: "low" | "medium" | "high";
  model_override?: string;
};

export type CronSpec = { version: number; timezone: string; jobs: CronJob[] };

export const EXPECTED_JOBS = ["pulse", "daily-reflection", "weekly-bounties", "quarterly-strategy", "donor-report"];

export function parseCronSpec(yamlText: string): CronSpec {
  const doc = parseYaml(yamlText) as CronSpec;
  if (!doc || !Array.isArray(doc.jobs)) throw new Error("cron.yaml has no jobs list");
  const names = doc.jobs.map((j) => j.name);
  for (const n of EXPECTED_JOBS) if (!names.includes(n)) throw new Error(`cron.yaml lacks job ${n}`);
  for (const j of doc.jobs) {
    if (!/^(\S+\s+){4}\S+$/.test(j.schedule.trim())) throw new Error(`job ${j.name}: schedule is not 5-field cron`);
    if (!j.prompt?.trim()) throw new Error(`job ${j.name}: empty prompt`);
  }
  return doc;
}

export type CronRenderOptions = {
  slug: string;
  /** absolute profile dir on the box, e.g. /opt/data/profiles/boulder-creek (inside the hermes container) */
  remoteProfileDir: string;
  /** e.g. "hermes" or "docker compose -f /opt/kami/infra/box/docker-compose.yml exec -T hermes hermes" */
  hermesCmd: string;
  /** only when set does model_override apply (a card that serves the larger model) */
  largeModel?: string | undefined;
  paused: boolean;
};

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function cronAddCommand(job: CronJob, spec: CronSpec, o: CronRenderOptions): string {
  const parts = [o.hermesCmd, "cron", "add", "--profile", shellQuote(o.slug), "--name", shellQuote(job.name)];
  parts.push("--schedule", shellQuote(job.schedule), "--tz", shellQuote(job.timezone ?? spec.timezone));
  if (job.pre_script) parts.push("--pre-script", shellQuote(`${o.remoteProfileDir}/${job.pre_script}`));
  if (job.toolsets?.length) parts.push("--toolsets", shellQuote(job.toolsets.join(",")));
  if (job.continuity) parts.push("--continuity");
  if (job.context_from?.length) parts.push("--context-from", shellQuote(job.context_from.join(",")));
  if (job.skill) parts.push("--skill", shellQuote(job.skill));
  if (job.reasoning_effort) parts.push("--reasoning-effort", job.reasoning_effort);
  if (job.model_override && o.largeModel && job.model_override === o.largeModel) {
    parts.push("--model", shellQuote(o.largeModel));
  }
  if (o.paused) parts.push("--disabled");
  parts.push(shellQuote(job.prompt.trim()));
  return parts.join(" ");
}

export function cronCommands(spec: CronSpec, o: CronRenderOptions): string[] {
  // remove-then-add keeps the deploy idempotent (verify: `hermes cron remove` name/flags)
  return spec.jobs.flatMap((job) => [
    `${o.hermesCmd} cron remove --profile ${shellQuote(o.slug)} --name ${shellQuote(job.name)} || true`,
    cronAddCommand(job, spec, o),
  ]);
}
