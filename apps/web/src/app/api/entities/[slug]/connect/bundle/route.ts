/**
 * `GET /api/entities/[slug]/connect/bundle` — the download.
 *
 *   (default)      a zip: SOUL.md, binding.json, mcp.json, .env.example,
 *                  skills/entity-steward/**, README.md
 *   ?format=json   the same files as text, for copy-paste and for tests
 *
 * Built by `src/lib/connect/bundle.ts` from the same rows and templates
 * `provisionEntity` renders, so a bundle and a deployed Hermes profile cannot
 * disagree. It contains no token: `mcp.json` and `.env.example` carry the
 * environment expansion, never a value.
 */
import { getDb } from "@/db/client";
import { json, slugOk, entityBySlug } from "@/lib/jobs/common";
import { connectAccess } from "@/lib/connect/access";
import { BundleError, buildConnectBundle, bundleFilename } from "@/lib/connect/bundle";
import { platformOrigin } from "@/lib/connect/endpoint";
import { zip } from "@/lib/connect/zip";
import { ProvisionError } from "@/lib/provisioning";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugOk(slug)) return json(400, { reason: "bad_slug" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_db" });

  const entity = await entityBySlug(db, slug);
  if (!entity) return json(404, { reason: "not_found" });

  const session = await getSession();
  const access = await connectAccess({ id: entity.id, created_by: entity.createdBy }, session?.user ?? null);
  if (!access.may_view) return json(session ? 403 : 401, { reason: session ? "forbidden" : "unauthenticated" });

  const url = new URL(req.url);
  const now = new Date();
  const origin = platformOrigin({ proto: req.headers.get("x-forwarded-proto"), host: req.headers.get("host") });

  let bundle;
  try {
    bundle = await buildConnectBundle(db, slug, { origin, now });
  } catch (err) {
    if (err instanceof ProvisionError) return json(err.code === "not_found" ? 404 : 422, { reason: err.code, message: err.message });
    if (err instanceof BundleError) return json(503, { reason: "template_missing", message: err.message });
    throw err;
  }

  if (url.searchParams.get("format") === "json") {
    return json(200, bundle, { "cache-control": "no-store" });
  }

  const archive = zip(bundle.files.map((f) => ({ path: f.path, content: f.content })), now);
  const body = new Uint8Array(archive);
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${bundleFilename(slug, now)}"`,
      "content-length": String(body.byteLength),
      "cache-control": "no-store",
    },
  });
}
