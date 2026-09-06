/**
 * `GET|POST /api/cron/binding-check` — nightly supersession check
 * (architecture §3). A published successor drafts the next binding version
 * as `pending_review`; findings land in `config.binding_findings.<slug>` and
 * mark the need superseded in the next `status.json`.
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { runBindingCheck } from "@/lib/jobs/binding-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const slug = new URL(req.url).searchParams.get("slug") ?? undefined;
  try {
    const results = await runBindingCheck({ db, ...(slug ? { slug } : {}) });
    const errors = results.filter((r) => r.status === "error").length;
    return json(errors ? 207 : 200, { job: "binding-check", results });
  } catch (err) {
    console.error("[cron/binding-check]", err);
    return json(500, { job: "binding-check", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
