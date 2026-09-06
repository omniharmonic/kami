/**
 * Who may ask the signing service to propose or read a treasury: the entity's
 * keyless treasury MCP on the box, presenting its per-entity `PLATFORM_MCP_TOKEN`
 * (architecture §10.2). Per-entity tokens are WP7's `src/lib/mcp/tokens.ts`
 * (`kami_<slug>_<48 hex>`, sha256 in `config.entity_tokens.<slug>`); a token
 * is only good for its own entity. The shared `PLATFORM_MCP_TOKEN` env secret
 * is accepted as a fallback for entities whose token has not been minted yet,
 * and in dev/test an unset secret lets a local curl through.
 */
import type { DbOrTx } from "@/db/events";
import { bearerFrom, json, safeEqual } from "@/lib/jobs/common";
import { verifyEntityToken } from "@/lib/mcp/tokens";
import { signingEnv, type SigningEnv } from "@/lib/signing/env";

export type McpAuth = { slug: string | null; via: "entity_token" | "shared_secret" | "open_dev" };

/**
 * `slug` is the entity the presented token is scoped to (null when the caller
 * used the shared secret, which is not entity-scoped). Returns a `Response`
 * when the caller is refused.
 */
export async function authorizeMcpFor(
  req: Request,
  db: DbOrTx,
  entitySlug: string | null,
  env: SigningEnv = signingEnv(),
  nodeEnv = process.env.NODE_ENV,
): Promise<Response | McpAuth> {
  const given = bearerFrom(req);
  if (given) {
    const scoped = await verifyEntityToken(db, given);
    if (scoped) {
      if (entitySlug && scoped.slug !== entitySlug) return json(403, { reason: "wrong_entity" });
      return { slug: scoped.slug, via: "entity_token" };
    }
    if (env.PLATFORM_MCP_TOKEN && safeEqual(given, env.PLATFORM_MCP_TOKEN)) return { slug: null, via: "shared_secret" };
    return json(401, { reason: "unauthorized" });
  }
  if (env.PLATFORM_MCP_TOKEN) return json(401, { reason: "unauthorized" });
  if (nodeEnv === "production") return json(503, { reason: "platform_mcp_token_unset" });
  return { slug: null, via: "open_dev" };
}
