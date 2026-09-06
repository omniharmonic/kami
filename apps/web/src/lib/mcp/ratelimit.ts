/**
 * Platform MCP rate limit: 600 requests per hour per entity token
 * (architecture §10.3). Two layers: a per-instance sliding window (fast) and
 * an hourly counter in `config` (`mcp_rate.<slug>`) so several Vercel
 * instances share one budget. Either layer refusing is a refusal; a DB error
 * never blocks the call (the memory layer already applied).
 */
import type { DbOrTx } from "@/db/events";
import { createMemoryLimiter } from "@/lib/ratelimit";
import { getConfig, setConfig } from "@/lib/jobs/common";

export const MCP_LIMIT_PER_HOUR = 600;
const HOUR_MS = 60 * 60 * 1000;

export type McpRateResult = { ok: true; remaining: number } | { ok: false; retry_after_s: number };

type Counter = { hour_start: string; n: number };

export function createMcpLimiter(now: () => number = Date.now, limit = MCP_LIMIT_PER_HOUR) {
  const memory = createMemoryLimiter(now);
  return {
    async check(db: DbOrTx | null, slug: string): Promise<McpRateResult> {
      const t = now();
      const m = memory.check(`mcp:${slug}`, limit, HOUR_MS);
      if (!m.ok) return { ok: false, retry_after_s: m.retry_after_s };
      if (!db) return { ok: true, remaining: limit - 1 };
      try {
        const key = `mcp_rate.${slug}`;
        const hourStart = new Date(Math.floor(t / HOUR_MS) * HOUR_MS).toISOString();
        const cur = await getConfig<Counter>(db, key);
        const n = cur && cur.hour_start === hourStart ? cur.n : 0;
        if (n >= limit) {
          const retry = Math.max(1, Math.ceil((Date.parse(hourStart) + HOUR_MS - t) / 1000));
          return { ok: false, retry_after_s: retry };
        }
        await setConfig(db, key, { hour_start: hourStart, n: n + 1 } satisfies Counter, new Date(t));
        return { ok: true, remaining: limit - n - 1 };
      } catch {
        return { ok: true, remaining: -1 };
      }
    },
    _reset: () => undefined,
  };
}

export const mcpLimiter = createMcpLimiter();
