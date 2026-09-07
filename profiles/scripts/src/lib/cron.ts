/**
 * cron.yaml → installed Hermes CLI commands. Unsupported semantics fail closed.
 * Verified against local `hermes cron add --help` on September 7, 2026.
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

/** Features the installed Hermes CLI cannot preserve. Never silently drop them. */
export function cronCompatibilityIssues(spec: CronSpec): string[] {
  const issues: string[] = [];
  if (spec.timezone) issues.push(`explicit timezone ${spec.timezone} (scheduler timezone must be verified)`);
  for (const job of spec.jobs) {
    const unsupported = [
      job.pre_script && "pre-script wake gating",
      job.toolsets?.length && "per-job toolsets",
      job.continuity && "continuity",
      job.context_from?.length && "context-from",
      job.reasoning_effort && "reasoning effort",
      job.model_override && "model override",
    ].filter(Boolean);
    if (unsupported.length) issues.push(`${job.name}: ${unsupported.join(", ")}`);
  }
  return issues;
}

export function cronAddCommand(job: CronJob, spec: CronSpec, o: CronRenderOptions): string {
  if (o.paused) throw new Error("Refusing to create an enabled cron job for a paused entity; Hermes create has no disabled flag");
  const issues = cronCompatibilityIssues({ ...spec, jobs: [job] });
  if (issues.length) throw new Error(`Hermes cron compatibility: ${issues.join("; ")}`);
  const parts = [o.hermesCmd, "--profile", shellQuote(o.slug), "cron", "create", shellQuote(job.schedule), shellQuote(job.prompt.trim()), "--name", shellQuote(job.name)];
  if (job.skill) parts.push("--skill", shellQuote(job.skill));
  return parts.join(" ");
}

export function cronCommands(spec: CronSpec, o: CronRenderOptions): string[] {
  if (o.paused) return []; // Never create-then-pause: a running scheduler could race us.
  return spec.jobs.map(job => cronAddCommand(job, spec, o));
}
