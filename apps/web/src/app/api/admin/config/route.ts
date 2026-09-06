/**
 * `/api/admin/config` — the `config` table over HTTP, for the chain scripts'
 * `HttpConfigStore` (`infra/chain/src/config.ts`: `GET ?key=` → `{key, value}`
 * or 404; `POST {key, value}`) and for `/admin`.
 *
 * Auth: `PLATFORM_ADMIN_TOKEN` bearer, or a `users.platform_admin` session.
 * Secrets never live in `config`; token hashes do (`entity_tokens.<slug>`),
 * and those are redacted from list responses.
 */
import { z } from "zod";
import { getDb } from "@/db/client";
import { AuthError, getSession } from "@/lib/session";
import { deleteConfig, getConfig, isAdminToken, json, listConfig, setConfig } from "@/lib/jobs/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REDACT = /^entity_tokens\./;

async function authorized(req: Request): Promise<boolean> {
  if (isAdminToken(req)) return true;
  try {
    const s = await getSession();
    return Boolean(s?.user.platform_admin);
  } catch (err) {
    if (err instanceof AuthError) return false;
    throw err;
  }
}

const putSchema = z.object({ key: z.string().min(1).max(200), value: z.unknown() });

export async function GET(req: Request) {
  if (!(await authorized(req))) return json(401, { reason: "unauthorized" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key) {
    const value = await getConfig(db, key);
    if (value === undefined) return json(404, { reason: "not_found", key });
    return json(200, { key, value: REDACT.test(key) ? "[redacted]" : value });
  }
  const prefix = url.searchParams.get("prefix") ?? undefined;
  const rows = await listConfig(db, prefix);
  return json(200, { keys: rows.map((r) => ({ ...r, value: REDACT.test(r.key) ? "[redacted]" : r.value })) });
}

async function write(req: Request): Promise<Response> {
  if (!(await authorized(req))) return json(401, { reason: "unauthorized" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { reason: "bad_json" });
  }
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) return json(400, { reason: "bad_request", issues: parsed.error.issues.map((i) => i.message) });
  if (REDACT.test(parsed.data.key)) return json(403, { reason: "refused", message: "entity tokens are minted, not written" });
  await setConfig(db, parsed.data.key, parsed.data.value ?? null);
  return json(200, { key: parsed.data.key, ok: true });
}

export const POST = write;
export const PUT = write;

export async function DELETE(req: Request) {
  if (!(await authorized(req))) return json(401, { reason: "unauthorized" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return json(400, { reason: "bad_request", message: "key is required" });
  await deleteConfig(db, key);
  return json(200, { key, ok: true });
}
