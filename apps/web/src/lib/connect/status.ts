/**
 * "Is it working?" — six signals, each of which is allowed to say it does not
 * know.
 *
 * The platform cannot see an agent. It has no way to reach into someone's
 * machine, no health check it can run against their brain, and no opinion about
 * whether their process is alive. All it can honestly report is **what has
 * arrived here**: a token minted, a request authenticated, a tool that changed
 * something, a pulse stored, a report from the gate, a chat path configured.
 * So every signal is one of three states —
 *
 *   not_configured  nothing has been set up that could produce this signal
 *   waiting         it is set up, and nothing has arrived yet
 *   seen            it arrived, and here is when
 *
 * — and never a bare tick. `at` is absent, never zero, when unknown.
 *
 * Where the times come from, and what each does not prove:
 *
 * - `token`      `config.entity_tokens.<slug>` (minted_at). A token existing
 *                proves nothing about an agent; it is the first prerequisite.
 * - `mcp_call`   `config.mcp_rate.<slug>.updated_at` — the hourly counter the
 *                MCP rate limiter writes on every authenticated request
 *                (`src/lib/mcp/ratelimit.ts`). It runs after the token is
 *                verified and before any tool, so its timestamp is exactly
 *                "this token was last used", for reads as well as writes. It
 *                does not record *which* tool: nothing on the read path does.
 *                (See the work-package report for the four-line change to
 *                `tokens.ts` that would record the tool name too.)
 * - `mcp_tool`   the newest `entity_events` row whose actor is `mcp:<slug>` —
 *                the write tools, which leave a record by design. A read-only
 *                call will never appear here, which the copy says plainly.
 * - `pulse`      the newest `pulses` row: the agent's own hourly heartbeat.
 * - `gate`       `src/lib/provenance.ts` — has the proxy in front of the model
 *                reported where it runs. Unrelated to the agent's own liveness.
 * - `chat`       whether a Hermes gateway is configured at all (`fake:` means
 *                the chat path answers from a fake) and when the box last said
 *                hello (`config.gpu_last_seen_at`).
 */
import { and, desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { getConfig } from "@/lib/jobs/common";
import { env, isFakeGateway } from "@/env";
import { servingProvenance, type Provenance } from "@/lib/provenance";
import { tokenState, type TokenState } from "./token";

export type SignalState = "not_configured" | "waiting" | "seen";

export type SignalKey = "token" | "mcp_call" | "mcp_tool" | "pulse" | "gate" | "chat";

export type Signal = {
  key: SignalKey;
  state: SignalState;
  /** ISO-8601 instant of the most recent evidence; null when there is none */
  at: string | null;
  /** seconds since `at`; null when there is no `at` (absent, never zero) */
  age_s: number | null;
  /** machine-readable extra the copy renders (a tool name, a provider, a slug) */
  detail: string | null;
};

export type ConnectStatus = {
  slug: string;
  generated_at: string;
  paused: boolean;
  token: TokenState;
  signals: Signal[];
};

/** The write tools leave these events; everything else the agent does is a read. */
export const EVENT_KIND_TO_TOOL: Record<string, string> = {
  "pulse.posted": "post_update",
  "reflection.posted": "post_update",
  "note.posted": "post_update",
  "strategy.drafted": "post_update",
  "donor_report.narrative": "post_update",
  "bounty.drafted": "draft_bounty",
  "mcp_token.minted": "—",
  "mcp_token.rotated": "—",
};

function ageOf(at: string | null, now: Date): number | null {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 1000)) : null;
}

function signal(key: SignalKey, state: SignalState, at: string | null, now: Date, detail: string | null = null): Signal {
  return { key, state, at, age_s: ageOf(at, now), detail };
}

/** `config.updated_at` for one key — the only timestamp the rate counter leaves behind. */
async function configUpdatedAt(db: DbOrTx, key: string): Promise<string | null> {
  const [row] = await db.select({ updatedAt: schema.config.updatedAt }).from(schema.config).where(eq(schema.config.key, key)).limit(1);
  return row?.updatedAt?.toISOString() ?? null;
}

export type StatusDeps = {
  now?: Date;
  /** default `src/lib/provenance.ts`; injectable so a test can pin it */
  provenance?: (slug: string) => Promise<Provenance>;
  /** default `src/env.ts`; the Hermes gateway URL as configured */
  gatewayIsFake?: () => boolean;
  gatewayIsConfigured?: () => boolean;
};

export type StatusEntity = { id: string; slug: string; paused_at?: Date | string | null };

export async function connectStatus(db: DbOrTx, entity: StatusEntity, deps: StatusDeps = {}): Promise<ConnectStatus> {
  const now = deps.now ?? new Date();
  const token = await tokenState(db, entity.slug, now);

  const lastCallAt = await configUpdatedAt(db, `mcp_rate.${entity.slug}`);
  const [lastEvent] = await db
    .select({ at: schema.entityEvents.at, kind: schema.entityEvents.kind })
    .from(schema.entityEvents)
    .where(and(eq(schema.entityEvents.entityId, entity.id), eq(schema.entityEvents.actor, `mcp:${entity.slug}`)))
    .orderBy(desc(schema.entityEvents.id))
    .limit(1);
  const [lastPulse] = await db
    .select({ at: schema.pulses.at, text: schema.pulses.text })
    .from(schema.pulses)
    .where(eq(schema.pulses.entityId, entity.id))
    .orderBy(desc(schema.pulses.at))
    .limit(1);

  const provenance = await (deps.provenance ?? servingProvenance)(entity.slug);
  const gatewayFake = (deps.gatewayIsFake ?? (() => isFakeGateway()))();
  const gatewayConfigured = (deps.gatewayIsConfigured ?? (() => Boolean(env.HERMES_GATEWAY_URL.trim())))();
  const heartbeat = await getConfig<string>(db, "gpu_last_seen_at");

  const signals: Signal[] = [
    token.exists
      ? signal("token", "seen", token.minted_at, now, token.fingerprint)
      : signal("token", "not_configured", null, now),
    !token.exists
      ? signal("mcp_call", "not_configured", null, now)
      : lastCallAt
        ? signal("mcp_call", "seen", lastCallAt, now)
        : signal("mcp_call", "waiting", null, now),
    !token.exists
      ? signal("mcp_tool", "not_configured", null, now)
      : lastEvent
        ? signal("mcp_tool", "seen", lastEvent.at?.toISOString() ?? null, now, EVENT_KIND_TO_TOOL[lastEvent.kind] ?? lastEvent.kind)
        : signal("mcp_tool", "waiting", null, now),
    lastPulse
      ? signal("pulse", "seen", lastPulse.at?.toISOString() ?? null, now, lastPulse.text ? "spoke" : "silent")
      : signal("pulse", "waiting", null, now),
    provenance.source === "gate"
      ? signal("gate", "seen", provenance.at, now, provenance.provider ?? provenance.placement ?? null)
      : provenance.source === "profile"
        ? signal("gate", "waiting", null, now, provenance.model)
        : signal("gate", "not_configured", null, now),
    gatewayFake || !gatewayConfigured
      ? signal("chat", "not_configured", null, now)
      : typeof heartbeat === "string"
        ? signal("chat", "seen", heartbeat, now)
        : signal("chat", "waiting", null, now),
  ];

  const pausedAt = entity.paused_at ?? null;
  return {
    slug: entity.slug,
    generated_at: now.toISOString(),
    paused: pausedAt !== null,
    token,
    signals,
  };
}
