/**
 * Who may ask the signing service to propose: the entity's keyless treasury
 * MCP on the box, presenting `PLATFORM_MCP_TOKEN` (architecture §10.2). Per-entity
 * scoped tokens (`src/lib/mcp/tokens.ts`, WP7) replace this shared secret when
 * they land; until then one bearer is accepted for every entity and the
 * proposal body's `entity` decides the scope (the validator refuses anything
 * that does not belong to that entity).
 */
import { bearerFrom, json, safeEqual } from "@/lib/jobs/common";
import { signingEnv, type SigningEnv } from "@/lib/signing/env";

export function authorizeMcp(req: Request, env: SigningEnv = signingEnv(), nodeEnv = process.env.NODE_ENV): Response | null {
  const given = bearerFrom(req);
  if (!env.PLATFORM_MCP_TOKEN) {
    if (nodeEnv === "production") return json(503, { reason: "platform_mcp_token_unset" });
    return null;
  }
  if (!given || !safeEqual(given, env.PLATFORM_MCP_TOKEN)) return json(401, { reason: "unauthorized" });
  return null;
}
