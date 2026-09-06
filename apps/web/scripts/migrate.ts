/**
 * pnpm --filter @kami/web db:migrate — applies src/db/migrations to DATABASE_URL
 * with the node-postgres driver (works against Neon's pooled or direct URL).
 * Idempotent: drizzle records applied migrations in `__drizzle_migrations`.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle({ client: pool });
try {
  await migrate(db, { migrationsFolder });
  console.log(`migrations applied from ${migrationsFolder}`);
} finally {
  await pool.end();
}
