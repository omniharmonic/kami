/**
 * `POST /api/entities/[slug]/pause` — the kill switch (ADR-E12, §5.9, T1.11).
 *
 * Auth: a guardian or steward session (or a platform admin), or the box
 * scripts' `PLATFORM_ADMIN_TOKEN` bearer (`profiles/scripts/src/pause.ts`
 * sends `{guardians[], reason, at, action}`).
 *
 * One guardian pauses. Resume needs two distinct guardian user ids within
 * 24 h (recorded as `resume_request` rows) — or, from a script, two distinct
 * guardian names. Writes `entities.paused_at`, `pause_events`,
 * `entity_events`, and pushes to `GATE_ADMIN_URL` when set.
 *
 * `GET` returns the current state and how many resume requests stand.
 */
import { getDb } from "@/db/client";
import { AuthError, getSession, hasRole } from "@/lib/session";
import { entityBySlug, isAdminToken, json, slugOk } from "@/lib/jobs/common";
import { applyPause, pauseBodySchema, PauseError, resumeRequesters, type PauseActor } from "@/lib/jobs/pause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function actorFor(entityId: string, req: Request): Promise<PauseActor | null> {
  if (isAdminToken(req)) return { kind: "script", label: "script:platform-admin" };
  const session = await getSession();
  if (!session) return null;
  const user = session.user;
  if (user.platform_admin || (await hasRole(user.id, entityId, "guardian")) || (await hasRole(user.id, entityId, "steward"))) {
    return { kind: "user", user_id: user.id, label: user.name ?? user.email };
  }
  return null;
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugOk(slug)) return json(400, { reason: "bad_slug" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const entity = await entityBySlug(db, slug);
  if (!entity) return json(404, { reason: "not_found" });

  let actor: PauseActor | null;
  try {
    actor = await actorFor(entity.id, req);
  } catch (err) {
    if (err instanceof AuthError) return json(err.status, { reason: err.status === 401 ? "unauthenticated" : "forbidden" });
    throw err;
  }
  if (!actor) return json(403, { reason: "forbidden", message: "a guardian or steward session, or the platform admin token, is required" });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = pauseBodySchema.safeParse(raw ?? {});
  if (!parsed.success) return json(400, { reason: "bad_request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });

  try {
    const outcome = await applyPause(db, entity, parsed.data, actor);
    return json(outcome.applied || outcome.already ? 200 : 202, { slug, ...outcome });
  } catch (err) {
    if (err instanceof PauseError) return json(err.status, { reason: "refused", message: err.message });
    console.error("[pause]", err);
    return json(500, { reason: (err as Error).message });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugOk(slug)) return json(400, { reason: "bad_slug" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const entity = await entityBySlug(db, slug);
  if (!entity) return json(404, { reason: "not_found" });
  const actor = await actorFor(entity.id, req);
  if (!actor) return json(403, { reason: "forbidden" });
  const now = new Date();
  return json(200, {
    slug,
    paused: entity.pausedAt !== null,
    paused_at: entity.pausedAt?.toISOString() ?? null,
    retired: entity.retiredAt !== null,
    resume_requests: entity.pausedAt ? (await resumeRequesters(db, entity, now)).length : 0,
    resume_needed: 2,
    as_of: now.toISOString(),
  });
}
