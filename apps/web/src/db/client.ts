/**
 * One Drizzle client per process. Neon serverless (WebSocket Pool, so
 * transactions work) in production or when DB_DRIVER=neon; node-postgres in
 * development. Returns null when DATABASE_URL is unset so pages can render
 * honestly from the last status file (ADR-E14). Both drivers are listed in
 * `serverExternalPackages`, so static imports are safe on the Node runtime.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import { env } from "@/env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Db | null | undefined;

function chooseDriver(url: string): "neon" | "pg" {
  if (env.DB_DRIVER) return env.DB_DRIVER;
  if (process.env.VERCEL || /neon\.tech/.test(url)) return "neon";
  return "pg";
}

export function getDb(): Db | null {
  if (cached !== undefined) return cached;
  const url = env.DATABASE_URL;
  if (!url) return (cached = null);
  if (chooseDriver(url) === "neon") {
    const pool = new NeonPool({ connectionString: url });
    cached = drizzleNeon({ client: pool, schema }) as unknown as Db;
  } else {
    const pool = new PgPool({ connectionString: url, max: 5, connectionTimeoutMillis: 3_000 });
    cached = drizzlePg({ client: pool, schema }) as unknown as Db;
  }
  return cached;
}

/** Test seam: inject a PGlite-backed db (see test-utils). */
export function setDbForTests(db: Db | null): void {
  cached = db;
}

/**
 * Run a read against the DB, returning `fallback` when the DB is unset or
 * unreachable. Every page read goes through this so Neon being down never
 * blanks a page (ADR-E14).
 */
export async function withDb<T>(fn: (db: Db) => Promise<T>, fallback: T): Promise<T> {
  try {
    const db = getDb();
    if (!db) return fallback;
    return await fn(db);
  } catch (err) {
    if (process.env.NODE_ENV !== "test") console.warn("[db] read failed, using fallback:", (err as Error).message);
    return fallback;
  }
}
