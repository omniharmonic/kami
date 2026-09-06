/**
 * Shared plumbing for the cron routes and the entity/gate APIs: bearer
 * checks with constant-time compares, the `config` table as a small KV, and
 * JSON responses. Env vars that only these modules need are read here with
 * zod, not in `src/env.ts` (that file is shared).
 */
import { timingSafeEqual } from "node:crypto";
import { eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

export const jobsEnvSchema = z.object({
  /** Vercel cron: `Authorization: Bearer $CRON_SECRET` on every invocation. */
  CRON_SECRET: z.string().min(1).optional(),
  /** Box scripts and the chain scripts' HttpConfigStore. */
  PLATFORM_ADMIN_TOKEN: z.string().min(1).optional(),
  /** The gate polls the pause set and posts heartbeats with this. */
  GATE_ADMIN_SECRET: z.string().min(1).optional(),
  /** Push pause/resume to the gate's admin endpoint when set (loopback on the box; a tunnel elsewhere). */
  GATE_ADMIN_URL: z.string().url().optional(),
  HERMES_WEBHOOK_SECRET: z.string().min(1).optional(),
  TWIN_BASE_URL: z.string().url().optional(),
  TWIN_TREE_DIR: z.string().min(1).optional(),
  KAMI_PULSE_CONTACT: z.string().min(1).default("hello@kami.invalid"),
});

export type JobsEnv = z.infer<typeof jobsEnvSchema>;

export function jobsEnv(source: NodeJS.ProcessEnv = process.env): JobsEnv {
  const parsed = jobsEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  // Never crash a route on a malformed optional; treat bad values as unset and say so once.
  console.warn("[jobs] env issues:", parsed.error.issues.map((i) => i.path.join(".")).join(", "));
  return jobsEnvSchema.parse({});
}

// ---------------------------------------------------------------------------
// auth helpers
// ---------------------------------------------------------------------------

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function bearerFrom(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * Vercel cron auth. In production the secret is mandatory; in dev/test an
 * unset secret lets `curl -X POST localhost:3000/api/cron/needs` work.
 */
export function authorizeCron(req: Request, env: JobsEnv = jobsEnv(), nodeEnv = process.env.NODE_ENV): Response | null {
  const given = bearerFrom(req);
  if (!env.CRON_SECRET) {
    if (nodeEnv === "production") return json(503, { reason: "cron_secret_unset" });
    return null;
  }
  if (!given || !safeEqual(given, env.CRON_SECRET)) return json(401, { reason: "unauthorized" });
  return null;
}

/** `PLATFORM_ADMIN_TOKEN` bearer — the box scripts and the chain scripts. */
export function isAdminToken(req: Request, env: JobsEnv = jobsEnv()): boolean {
  const given = bearerFrom(req);
  return Boolean(given && env.PLATFORM_ADMIN_TOKEN && safeEqual(given, env.PLATFORM_ADMIN_TOKEN));
}

/** The gate: `X-Gate-Admin: <secret>` or `Authorization: Bearer <secret>` (its `KAMI_PLATFORM_TOKEN`). */
export function isGateSecret(req: Request, env: JobsEnv = jobsEnv()): boolean {
  if (!env.GATE_ADMIN_SECRET) return false;
  const header = req.headers.get("x-gate-admin");
  if (header && safeEqual(header.trim(), env.GATE_ADMIN_SECRET)) return true;
  const bearer = bearerFrom(req);
  return Boolean(bearer && safeEqual(bearer, env.GATE_ADMIN_SECRET));
}

// ---------------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------------

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export function slugOk(slug: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(slug);
}

// ---------------------------------------------------------------------------
// config KV
// ---------------------------------------------------------------------------

export async function getConfig<T = unknown>(db: DbOrTx, key: string): Promise<T | undefined> {
  const [row] = await db.select({ value: schema.config.value }).from(schema.config).where(eq(schema.config.key, key)).limit(1);
  return row ? (row.value as T) : undefined;
}

export async function setConfig(db: DbOrTx, key: string, value: unknown, now = new Date()): Promise<void> {
  await db
    .insert(schema.config)
    .values({ key, value: value as object, updatedAt: now })
    .onConflictDoUpdate({ target: schema.config.key, set: { value: value as object, updatedAt: now } });
}

export async function deleteConfig(db: DbOrTx, key: string): Promise<void> {
  await db.delete(schema.config).where(eq(schema.config.key, key));
}

export async function listConfig(db: DbOrTx, prefix?: string): Promise<Array<{ key: string; value: unknown; updated_at: string | null }>> {
  const rows = prefix
    ? await db.select().from(schema.config).where(like(schema.config.key, `${prefix.replace(/[%_]/g, "\\$&")}%`)).orderBy(schema.config.key)
    : await db.select().from(schema.config).orderBy(schema.config.key);
  return rows.map((r) => ({ key: r.key, value: r.value, updated_at: r.updatedAt?.toISOString() ?? null }));
}

/**
 * Insert-if-absent on a config key: the idempotency primitive for webhook
 * event ids and one-shot markers. Returns true when this call claimed the key.
 */
export async function claimConfigKey(db: DbOrTx, key: string, value: unknown, now = new Date()): Promise<boolean> {
  const res = await db
    .insert(schema.config)
    .values({ key, value: value as object, updatedAt: now })
    .onConflictDoNothing({ target: schema.config.key })
    .returning({ key: schema.config.key });
  return res.length > 0;
}

/** `true` while the last gate/Hermes heartbeat is within `windowMs` (default 10 min). */
export async function gpuOnline(db: DbOrTx, now = new Date(), windowMs = 10 * 60_000): Promise<boolean> {
  const seen = await getConfig<string>(db, "gpu_last_seen_at");
  if (typeof seen !== "string") return false;
  const t = Date.parse(seen);
  return Number.isFinite(t) && now.getTime() - t <= windowMs;
}

/** Entities that still exist (retired ones keep their record but no job touches them). */
export async function activeEntities(db: DbOrTx, slug?: string) {
  const rows = await db.select().from(schema.entities).where(sql`${schema.entities.retiredAt} is null`).orderBy(schema.entities.slug);
  return slug ? rows.filter((r) => r.slug === slug) : rows;
}

export async function entityBySlug(db: DbOrTx, slug: string) {
  const [row] = await db.select().from(schema.entities).where(eq(schema.entities.slug, slug)).limit(1);
  return row ?? null;
}
