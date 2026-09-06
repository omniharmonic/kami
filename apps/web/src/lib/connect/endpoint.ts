/**
 * Where an agent points itself.
 *
 * One endpoint, one path: `{origin}/mcp` (architecture §6.2 — `src/proxy.ts`
 * rewrites it to `/api/mcp`, and the Hermes profile template names the same
 * URL). The origin is whatever this deployment publishes as itself, in this
 * order:
 *
 *   1. `PLATFORM_URL` — what provisioning writes into a profile's config.yaml,
 *      so a bundle and a profile cannot disagree about the address;
 *   2. `BETTER_AUTH_URL` — set on every deployment that has sessions at all;
 *   3. the request's own forwarded host, which is what the person is looking
 *      at right now;
 *   4. `http://127.0.0.1:3000`, the dev default.
 *
 * Nothing here guesses at https for a bare host: a wrong scheme in a copied
 * command fails loudly, which is better than a token sent in the clear.
 */

export const MCP_PATH = "/mcp";

export type RequestOrigin = { proto?: string | null; host?: string | null };

export const DEV_ORIGIN = "http://127.0.0.1:3000";

function clean(url: string | null | undefined): string | null {
  const v = (url ?? "").trim().replace(/\/+$/, "");
  return v ? v : null;
}

/** The origin an agent should use, given the environment and (optionally) this request. */
export function platformOrigin(req: RequestOrigin | null = null, source: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = clean(source.PLATFORM_URL) ?? clean(source.BETTER_AUTH_URL);
  if (fromEnv) return fromEnv;
  const host = clean(req?.host);
  if (host) {
    const proto = clean(req?.proto)?.split(",")[0]?.trim() || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return DEV_ORIGIN;
}

/** `{origin}/mcp` — the one URL an MCP client needs. */
export function mcpEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${MCP_PATH}`;
}

/** The `Authorization` header an agent sends, with the secret left as an env expansion. */
export const AUTH_HEADER_TEMPLATE = "Bearer ${PLATFORM_MCP_TOKEN}";

export const TOKEN_ENV_VAR = "PLATFORM_MCP_TOKEN";
export const SLUG_ENV_VAR = "KAMI_ENTITY_SLUG";
