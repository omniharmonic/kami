/**
 * The Hermes worked example: the profile this project itself deploys.
 *
 * Nothing here is a second way to connect — Hermes is an MCP client like any
 * other and uses the same endpoint and the same token. What is Hermes-specific
 * is the profile format (`config.yaml`), the five cron jobs, and the deploy
 * script that renders them. All three are read from the checked-in templates
 * rather than retyped, through the same `renderProfileConfig` provisioning
 * uses, so the tab cannot show a profile the box would not get.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { DbOrTx } from "@/db/events";
import { renderProfileConfig } from "@/lib/provisioning";
import { twinTargetFor } from "@/lib/summon/twin";
import { templatesDirCandidates } from "./bundle";
import { SLUG_ENV_VAR, TOKEN_ENV_VAR } from "./endpoint";
import { includedTools } from "./tools";

export type CronJob = { name: string; schedule: string; prompt: string };

export type HermesProfile = {
  slug: string;
  config_yaml: string;
  env_example: string;
  timezone: string;
  jobs: CronJob[];
  /** tool names the template's `include:` lists, per MCP server */
  included: { platform: string[]; twin: string[] };
};

/** `profiles/templates/cron.yaml`, as data. Empty when the template is unreadable. */
export async function cronTemplate(): Promise<{ timezone: string; jobs: CronJob[] }> {
  for (const dir of templatesDirCandidates()) {
    try {
      const text = await readFile(path.join(dir, "cron.yaml"), "utf8");
      const doc = parseYaml(text) as { timezone?: string; jobs?: Array<{ name?: string; schedule?: string; prompt?: string }> };
      return {
        timezone: doc.timezone ?? "UTC",
        jobs: (doc.jobs ?? []).map((j) => ({ name: j.name ?? "", schedule: j.schedule ?? "", prompt: (j.prompt ?? "").trim() })).filter((j) => j.name),
      };
    } catch {
      // try the next candidate root
    }
  }
  return { timezone: "UTC", jobs: [] };
}

export async function hermesProfile(db: DbOrTx, entity: { id: string; slug: string; paused: boolean }, opts: { platformUrl: string }): Promise<HermesProfile> {
  const twin = await twinTargetFor(entity.id, { db });
  const config = await renderProfileConfig({
    slug: entity.slug,
    platform_url: opts.platformUrl,
    twin_base_url: twin.base_url,
    paused: entity.paused,
  });
  const cron = await cronTemplate();
  return {
    slug: entity.slug,
    config_yaml: config,
    env_example: `${TOKEN_ENV_VAR}=<the value shown once above>\n${SLUG_ENV_VAR}=${entity.slug}\n`,
    timezone: cron.timezone,
    jobs: cron.jobs,
    included: { platform: includedTools(config, "platform"), twin: includedTools(config, "twin") },
  };
}
