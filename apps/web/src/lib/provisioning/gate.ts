/**
 * `gate.yaml`, generated from the database (architecture §5.7, plan T3.3).
 *
 * The box never hand-writes this file: it fetches it from
 * `GET /api/admin/gate`. Everything in it is derived —
 *
 *  - one budget block per non-retired entity (defaults 800 000 prompt /
 *    40 000 output tokens a day, cron on its own prompt budget so chat cannot
 *    starve the weekly job), overridable per entity through `config`;
 *  - a `-staging` block per entity at a quarter of the budget, because the
 *    summon preview runs against the staging profile through the same gate;
 *  - concurrency 2 in flight, queue 8 (§5.4);
 *  - the paused set — paused *or* retired slugs, the same set
 *    `/api/gate/pause-set` serves, so a gateway restart cannot resurrect a
 *    paused entity even before the first poll.
 *
 * Shape and key names follow `infra/box/gate.yaml.example` exactly.
 */

import { stringify } from "yaml";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { getConfig } from "@/lib/jobs/common";

export const BUDGET_DEFAULTS = {
  prompt_tokens_per_day: 800_000,
  output_tokens_per_day: 40_000,
  cron_prompt_tokens_per_day: 400_000,
} as const;

/** A preview profile is for one person testing one voice block; a quarter is plenty. */
export const STAGING_DIVISOR = 4;

export const CONCURRENCY_DEFAULTS = { per_entity: 2, queue: 8 } as const;

export type Budget = { prompt_tokens_per_day: number; output_tokens_per_day: number; cron_prompt_tokens_per_day: number };

export type GateConfig = {
  upstream_url: string;
  listen: string;
  passthrough: false;
  budgets: Record<string, Budget>;
  concurrency: { per_entity: number; queue: number };
  paused: string[];
  platform: { pause_set_url: string; token: string; poll_seconds: number };
  events_dir: string;
  provenance: GateProvenance;
};

/**
 * Where the model actually runs. The gate requires this and refuses to start
 * without it, because the public "how I work" page renders it rather than
 * asserting anything about inference. The platform therefore cannot invent a
 * default: it can only pass on what an operator has declared, which is why
 * `gateConfig` throws rather than guessing `owned`.
 */
export type GateProvenance = {
  placement: "owned" | "rented" | "hosted";
  provider: string;
  model?: string;
  note?: string;
};

export class ProvenanceNotDeclared extends Error {
  constructor() {
    super(
      "cannot generate gate.yaml: nobody has declared where the model runs. " +
        "Set the config key `gate.provenance` to " +
        '{"placement": "owned" | "rented" | "hosted", "provider": "...", "model": "..."} ' +
        "— for example {\"placement\":\"hosted\",\"provider\":\"OpenAI\"} while running on a " +
        "hosted API, or {\"placement\":\"owned\",\"provider\":\"vLLM on the DGX Spark\"} once the " +
        "hardware is running. The platform will not guess this: the page tells people where their " +
        "words go, and a guess there would be a lie.",
    );
    this.name = "ProvenanceNotDeclared";
  }
}

const PLACEMENTS = new Set(["owned", "rented", "hosted"]);

function provenanceFrom(raw: unknown): GateProvenance {
  if (!raw || typeof raw !== "object") throw new ProvenanceNotDeclared();
  const r = raw as Record<string, unknown>;
  const placement = typeof r.placement === "string" ? r.placement : "";
  if (!PLACEMENTS.has(placement)) throw new ProvenanceNotDeclared();
  const provider = typeof r.provider === "string" && r.provider.trim() ? r.provider.trim() : "";
  if (!provider) throw new ProvenanceNotDeclared();
  const out: GateProvenance = { placement: placement as GateProvenance["placement"], provider };
  if (typeof r.model === "string" && r.model.trim()) out.model = r.model.trim();
  if (typeof r.note === "string" && r.note.trim()) out.note = r.note.trim();
  return out;
}

export type GateOptions = {
  upstream_url?: string;
  listen?: string;
  platform_url?: string;
  poll_seconds?: number;
  events_dir?: string;
  provenance?: GateProvenance;
  /** include a `<slug>-staging` budget per entity (the preview profiles) */
  staging?: boolean;
};

const GATE_CONFIG_KEYS = {
  budgets: "gate.budgets",
  concurrency: "gate.concurrency",
  upstream: "gate.upstream_url",
  listen: "gate.listen",
  events: "gate.events_dir",
  poll: "gate.poll_seconds",
  provenance: "gate.provenance",
} as const;

function positiveInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

export function budgetFrom(raw: unknown, base: Budget = BUDGET_DEFAULTS): Budget {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    prompt_tokens_per_day: positiveInt(o["prompt_tokens_per_day"], base.prompt_tokens_per_day),
    output_tokens_per_day: positiveInt(o["output_tokens_per_day"], base.output_tokens_per_day),
    cron_prompt_tokens_per_day: positiveInt(o["cron_prompt_tokens_per_day"], base.cron_prompt_tokens_per_day),
  };
}

export function scaleBudget(b: Budget, divisor: number): Budget {
  const d = Math.max(1, Math.round(divisor));
  return {
    prompt_tokens_per_day: Math.max(1, Math.floor(b.prompt_tokens_per_day / d)),
    output_tokens_per_day: Math.max(1, Math.floor(b.output_tokens_per_day / d)),
    cron_prompt_tokens_per_day: Math.max(1, Math.floor(b.cron_prompt_tokens_per_day / d)),
  };
}

/** The generated config, as an object. `renderGateYaml` turns it into the file. */
export async function gateConfig(db: DbOrTx, opts: GateOptions = {}): Promise<GateConfig> {
  const rows = await db
    .select({ slug: schema.entities.slug, pausedAt: schema.entities.pausedAt, retiredAt: schema.entities.retiredAt, profile: schema.entities.hermesProfile })
    .from(schema.entities)
    .orderBy(schema.entities.slug);
  const perEntity = (await getConfig<Record<string, unknown>>(db, GATE_CONFIG_KEYS.budgets)) ?? {};
  const defaults = budgetFrom(perEntity["default"], BUDGET_DEFAULTS);
  const concurrencyRaw = (await getConfig<Record<string, unknown>>(db, GATE_CONFIG_KEYS.concurrency)) ?? {};
  const platformUrl = (opts.platform_url ?? process.env.PLATFORM_URL ?? process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

  const budgets: Record<string, Budget> = {};
  const paused: string[] = [];
  for (const row of rows) {
    const slug = row.profile ?? row.slug;
    if (row.retiredAt) {
      // A retired kami keeps its record and its page; it gets no budget and
      // stays in the paused set forever.
      paused.push(slug);
      continue;
    }
    budgets[slug] = budgetFrom(perEntity[slug], defaults);
    if (opts.staging !== false) budgets[`${slug}-staging`] = scaleBudget(budgets[slug]!, STAGING_DIVISOR);
    if (row.pausedAt) {
      paused.push(slug);
      if (opts.staging !== false) paused.push(`${slug}-staging`);
    }
  }

  return {
    upstream_url: opts.upstream_url ?? (await getConfig<string>(db, GATE_CONFIG_KEYS.upstream)) ?? "http://vllm:8000",
    listen: opts.listen ?? (await getConfig<string>(db, GATE_CONFIG_KEYS.listen)) ?? "0.0.0.0:8001",
    passthrough: false,
    budgets,
    concurrency: {
      per_entity: positiveInt(concurrencyRaw["per_entity"], CONCURRENCY_DEFAULTS.per_entity),
      queue: positiveInt(concurrencyRaw["queue"], CONCURRENCY_DEFAULTS.queue),
    },
    paused: [...new Set(paused)].sort(),
    platform: {
      pause_set_url: `${platformUrl}/api/gate/pause-set`,
      // The secret itself never leaves the platform: the file carries the shell
      // expansion the gate resolves from its own environment (X.1).
      token: "${GATE_PLATFORM_TOKEN}",
      poll_seconds: positiveInt(opts.poll_seconds ?? concurrencyRaw["poll_seconds"], 30),
    },
    events_dir: opts.events_dir ?? (await getConfig<string>(db, GATE_CONFIG_KEYS.events)) ?? "/var/lib/kami/gate",
    provenance: opts.provenance ?? provenanceFrom(await getConfig<unknown>(db, GATE_CONFIG_KEYS.provenance)),
  };
}

const HEADER = `# entity-gate configuration — GENERATED from the platform database by
# apps/web/src/lib/provisioning/gate.ts (architecture §5.7, plan T3.3).
# The box fetches this from GET /api/admin/gate. Do not hand-edit on the box:
# the next fetch overwrites it. Budgets and concurrency come from the \`config\`
# table (gate.budgets, gate.concurrency); the paused set comes from
# entities.paused_at / retired_at, the same source as /api/gate/pause-set.
`;

export function renderGateYaml(config: GateConfig, generatedAt = new Date()): string {
  const body = stringify(config, { lineWidth: 0 });
  // `${GATE_PLATFORM_TOKEN}` must reach the file unquoted-but-literal; the YAML
  // writer quotes it, which the gate's env expansion handles either way.
  return `${HEADER}# generated_at: ${generatedAt.toISOString()}\n${body}`;
}
