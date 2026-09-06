/**
 * `/api/admin/profiles` — provision or re-provision an entity's Hermes profile
 * from the database (architecture §12.3, plan T3.2).
 *
 *   GET  ?slug=<slug>[&staging=1]  → the plan, nothing written remotely
 *   POST {slug, staging?, deploy?} → provision; with `deploy: true` and
 *                                    `KAMI_BOX_HOST` set it shells out to
 *                                    `profiles/scripts/deploy-profile.ts`
 *
 * Auth: `PLATFORM_ADMIN_TOKEN` bearer (the box scripts) or a
 * `users.platform_admin` session. The response never carries the minted
 * `PLATFORM_MCP_TOKEN` — only the path of the `.env` it was written into, on
 * the machine running this app. Secrets do not travel through an admin API.
 */
import { z } from "zod";
import { getDb } from "@/db/client";
import { isAdminToken, json, slugOk } from "@/lib/jobs/common";
import { AuthError, getSession } from "@/lib/session";
import { ProvisionError, provisionEntity, type ProvisionResult } from "@/lib/provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: Request): Promise<{ ok: boolean; actor: string | null }> {
  if (isAdminToken(req)) return { ok: true, actor: "platform_admin_token" };
  try {
    const s = await getSession();
    return { ok: Boolean(s?.user.platform_admin), actor: s?.user.id ?? null };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, actor: null };
    throw err;
  }
}

/** The plan, minus anything secret. */
function redact(result: ProvisionResult) {
  return {
    ...result,
    files: result.files.map((f) => ({ ...f, ...(f.secret ? { note: "written locally with mode 600; the token itself is not returned" } : {}) })),
    output: result.output ? result.output.replace(/kami_[a-z0-9-]+_[0-9a-f]{48}/g, "kami_<redacted>") : null,
  };
}

const bodySchema = z.object({
  slug: z.string().min(1).max(64),
  staging: z.boolean().optional(),
  /** false (the default) always produces a plan, even when KAMI_BOX_HOST is set */
  deploy: z.boolean().optional(),
  out_dir: z.string().max(1000).optional(),
});

export async function GET(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return json(401, { reason: "unauthorized" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (!slug || !slugOk(slug)) return json(400, { reason: "bad_request", message: "slug is required" });
  try {
    const result = await provisionEntity(slug, db, {
      staging: url.searchParams.get("staging") === "1",
      boxHost: null, // GET never deploys
      // …and never rotates the live token: a GET is a preview, not a change.
      mintToken: false,
      actor: auth.actor,
    });
    return json(200, redact(result));
  } catch (err) {
    if (err instanceof ProvisionError) return json(err.code === "not_found" ? 404 : 422, { reason: err.code, message: err.message });
    throw err;
  }
}

export async function POST(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return json(401, { reason: "unauthorized" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { reason: "bad_json" });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json(400, { reason: "bad_request", issues: parsed.error.issues.map((i) => i.message) });
  const { slug, staging, deploy, out_dir } = parsed.data;
  if (!slugOk(slug)) return json(400, { reason: "bad_request", message: "bad slug" });

  const boxHost = deploy ? (process.env.KAMI_BOX_HOST ?? null) : null;
  try {
    const result = await provisionEntity(slug, db, {
      ...(staging === undefined ? {} : { staging }),
      boxHost,
      ...(out_dir ? { outDir: out_dir } : {}),
      actor: auth.actor,
    });
    return json(200, redact(result));
  } catch (err) {
    if (err instanceof ProvisionError) return json(err.code === "not_found" ? 404 : 422, { reason: err.code, message: err.message });
    throw err;
  }
}
