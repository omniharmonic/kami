/**
 * `GET /api/admin/gate` — the generated `gate.yaml` the box fetches
 * (architecture §5.7, plan T3.3). Per-entity daily budgets, the staging
 * budgets the summon preview draws on, concurrency, and the paused set, all
 * derived from the database so the file on the box can never drift from it.
 *
 * `Accept: application/json` (or `?format=json`) returns the same config as
 * JSON, for `/admin`.
 *
 * Auth: the gate's own shared secret (`GATE_ADMIN_SECRET`), the
 * `PLATFORM_ADMIN_TOKEN` bearer, or a `users.platform_admin` session. The
 * file itself contains no secret: the platform token is left as the
 * `${GATE_PLATFORM_TOKEN}` the gate expands from its own environment.
 */
import { getDb } from "@/db/client";
import { isAdminToken, isGateSecret, json } from "@/lib/jobs/common";
import { AuthError, getSession } from "@/lib/session";
import { gateConfig, renderGateYaml } from "@/lib/provisioning/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: Request): Promise<boolean> {
  if (isGateSecret(req) || isAdminToken(req)) return true;
  try {
    const s = await getSession();
    return Boolean(s?.user.platform_admin);
  } catch (err) {
    if (err instanceof AuthError) return false;
    throw err;
  }
}

export async function GET(req: Request) {
  if (!(await authorized(req))) return json(401, { reason: "unauthorized" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });

  const url = new URL(req.url);
  const config = await gateConfig(db, {
    ...(url.searchParams.get("platform_url") ? { platform_url: url.searchParams.get("platform_url")! } : {}),
    ...(url.searchParams.get("staging") === "0" ? { staging: false } : {}),
  });

  const wantsJson = url.searchParams.get("format") === "json" || (req.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) return json(200, config);

  return new Response(renderGateYaml(config), {
    status: 200,
    headers: { "content-type": "text/yaml; charset=utf-8", "cache-control": "no-store" },
  });
}
