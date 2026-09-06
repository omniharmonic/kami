/**
 * `GET|POST /api/cron/commons` — the weekly commons sync (ADR-E08, T1.9):
 * entity/page, the weekly entity/state roll-up, memos, reports and bounty
 * notes into the `entities` vault with the fence pattern.
 *
 * With no `PARACHUTE_HUB_URL`/`PARACHUTE_ENTITIES_TOKEN` the job answers 503
 * `commons_unconfigured` rather than failing loudly — the vault is a phase-1
 * dependency (TW-11). `?dry=1` renders into an in-memory store and reports
 * what would change, writing nothing.
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { commonsEnvFrom, ParachuteClient } from "@/lib/commons/client";
import { MemoryNoteStore, runCommonsSync, type NoteStore } from "@/lib/commons/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const slug = url.searchParams.get("slug") ?? undefined;

  let env: ReturnType<typeof commonsEnvFrom>;
  try {
    env = commonsEnvFrom();
  } catch (err) {
    return json(503, { job: "commons", reason: (err as Error).message });
  }
  let store: NoteStore;
  let vault = "entities";
  if (dry || !env) {
    if (!dry) return json(503, { job: "commons", reason: "commons_unconfigured", detail: "set PARACHUTE_HUB_URL and PARACHUTE_ENTITIES_TOKEN" });
    store = new MemoryNoteStore();
  } else {
    const client = ParachuteClient.fromEnv(env);
    if (!client) return json(503, { job: "commons", reason: "commons_unconfigured" });
    store = client;
    vault = env.PARACHUTE_ENTITIES_VAULT;
  }
  try {
    const report = await runCommonsSync({ db: dry ? db : db, store, vault, ...(slug ? { slug } : {}), ...(env ? { commonsBase: env.COMMONS_FRONT_RANGE_BASE_URL } : {}) });
    return json(report.counts.failed ? 207 : 200, { job: "commons", dry, ...report });
  } catch (err) {
    console.error("[cron/commons]", err);
    return json(500, { job: "commons", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
