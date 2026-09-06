/**
 * `GET /api/entities/[slug]/connect/status` — the six signals behind the
 * connect page's "is it working?" section, as JSON, for the panel to poll.
 *
 * Session-authenticated and role-scoped: this is a page's data source, not a
 * machine API, and it says nothing a role-holder cannot already see on the
 * page. It carries no token value — only the public prefix, the fingerprint and
 * the age — so a leaked response leaks nothing that can connect.
 *
 * `no-store`, always: a cached "waiting" would be the one wrong answer that
 * matters, since the whole point of the poll is to catch the moment it changes.
 */
import { getDb } from "@/db/client";
import { json, slugOk, entityBySlug } from "@/lib/jobs/common";
import { connectAccess } from "@/lib/connect/access";
import { connectStatus } from "@/lib/connect/status";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugOk(slug)) return json(400, { reason: "bad_slug" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_db" });

  const entity = await entityBySlug(db, slug);
  if (!entity) return json(404, { reason: "not_found" });

  const session = await getSession();
  const access = await connectAccess({ id: entity.id, created_by: entity.createdBy }, session?.user ?? null);
  if (!access.may_view) return json(session ? 403 : 401, { reason: session ? "forbidden" : "unauthenticated" });

  const status = await connectStatus(db, { id: entity.id, slug: entity.slug, paused_at: entity.pausedAt });
  return json(200, status, { "cache-control": "no-store" });
}
