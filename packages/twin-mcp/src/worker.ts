/**
 * Cloudflare Worker entry: Streamable HTTP, stateless (one transport per
 * request, no session id), `cf: { cacheTtl }` on tree fetches, a per-IP
 * token bucket (60/min) and an optional `X-API-Key` tier.
 *
 * The token bucket is an in-memory Map — per isolate, not global. A Workers
 * Rate Limiting binding (`env.RATE_LIMITER.limit({ key })`) replaces it when
 * deployed; *verify* the binding's availability on the twin's plan. Uses
 * `@modelcontextprotocol/sdk` 1.30.0's WebStandardStreamableHTTPServerTransport,
 * which runs on Workers without Node shims; the 2.0 `@modelcontextprotocol/server`
 * package was evaluated and not adopted (see README).
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ToolContext } from "./context.js";
import { aboutText } from "./resources.js";
import { createServer } from "./server.js";
import { DEFAULT_TREE, TreeReader, type FetchLike } from "./tree.js";

export interface WorkerEnv {
  /** Base URL of the published tree; defaults to https://data.bioregionaltwin.org */
  TREE_BASE_URL?: string;
  /** Comma-separated API keys granted the higher tier. Issued by the twin's operator. */
  API_KEYS?: string;
  CONTACT?: string;
  /** Comma-separated origins resolve_entity may fetch a binding_url from. */
  BINDING_ORIGINS?: string;
  /** Optional Workers rate-limiting binding; replaces the in-memory bucket when present. */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export const ANON_PER_MIN = 60;
export const KEYED_PER_MIN = 600;

interface Bucket {
  tokens: number;
  updated: number;
}

/** Token bucket per key; refills linearly to `perMin` over 60 s. */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  take(key: string, perMin: number): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: perMin, updated: t };
    b.tokens = Math.min(perMin, b.tokens + ((t - b.updated) / 60_000) * perMin);
    b.updated = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear(); // crude bound for a per-isolate map
    return true;
  }
}

export interface WorkerHandlerOptions {
  fetch?: FetchLike;
  now?: () => number;
  buckets?: TokenBuckets;
}

export function createWorkerHandler(opts: WorkerHandlerOptions = {}) {
  const buckets = opts.buckets ?? new TokenBuckets(opts.now);
  const now = opts.now ?? (() => Date.now());
  let reader: TreeReader | null = null;
  const readerFor = (env: WorkerEnv) =>
    (reader ??= new TreeReader({ tree: env.TREE_BASE_URL ?? DEFAULT_TREE, contact: env.CONTACT, fetch: opts.fetch, now, cfCache: !opts.fetch }));

  return {
    async fetch(request: Request, env: WorkerEnv = {}): Promise<Response> {
      const url = new URL(request.url);
      const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? "anonymous";
      const key = request.headers.get("X-API-Key");
      const keys = (env.API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const keyed = !!key && keys.includes(key);
      const tier = keyed ? "keyed" : "anonymous";

      const withTier = (res: Response) => {
        const headers = new Headers(res.headers);
        headers.set("x-ratelimit-tier", tier);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      };
      if (url.pathname === "/healthz") return new Response("ok", { status: 200 });

      let allowed: boolean;
      if (env.RATE_LIMITER && !keyed) allowed = (await env.RATE_LIMITER.limit({ key: ip })).success;
      else allowed = buckets.take(keyed ? `key:${key}` : `ip:${ip}`, keyed ? KEYED_PER_MIN : ANON_PER_MIN);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "rate_limited", tier, limit_per_min: keyed ? KEYED_PER_MIN : ANON_PER_MIN }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60" },
        });
      }

      const ctx: ToolContext = {
        reader: readerFor(env),
        bindings: new Map(),
        bindingOrigins: (env.BINDING_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        mode: "worker",
        now,
      };

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/about")) {
        return withTier(new Response(aboutText(ctx), { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } }));
      }
      if (url.pathname !== "/mcp") return withTier(new Response("not found; MCP endpoint is /mcp", { status: 404 }));

      const server = createServer(ctx);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      try {
        return withTier(await transport.handleRequest(request));
      } finally {
        // Stateless: nothing to keep between requests.
        void server.close().catch(() => undefined);
      }
    },
  };
}

const handler = createWorkerHandler();
export default handler;
