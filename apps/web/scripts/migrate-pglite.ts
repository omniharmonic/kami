/**
 * pnpm --filter @kami/web db:migrate:pglite — applies every migration to a fresh
 * in-memory PGlite and reports the table count. A quick "do the migrations
 * apply cleanly" check that needs no server.
 */
import { sql } from "drizzle-orm";
import { createTestDb, closeTestDb } from "../src/db/test-utils";

const db = await createTestDb();
const res = await db.execute(
  sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
);
console.log(`ok — ${(res.rows[0] as { n: number }).n} tables in a fresh PGlite`);
await closeTestDb(db);
