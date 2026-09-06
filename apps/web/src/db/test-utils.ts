/**
 * PGlite-backed test database: a fresh in-memory Postgres per call with every
 * migration in `src/db/migrations` applied. No server, no Docker (CLAUDE.md).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as schema from "./schema";

export type TestDb = PgliteDatabase<typeof schema> & { $client: PGlite };

export const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return db as TestDb;
}

export async function closeTestDb(db: TestDb): Promise<void> {
  await db.$client.close();
}

/** Seed one entity (and the users it references) for tests that need FK targets. */
export async function seedEntity(
  db: TestDb,
  opts: {
    slug?: string;
    name?: string;
    archetype?: schema.Archetype;
    paused?: boolean;
    /**
     * Consultation is recorded by default, because a seeded entity stands in
     * for a live one and an unconsulted entity is deliberately unpublishable
     * (PRD §13 #4). Pass false to exercise that gate.
     */
    consultationDone?: boolean;
  } = {},
) {
  const slug = opts.slug ?? "boulder-creek";
  const [row] = await db
    .insert(schema.entities)
    .values({
      id: `entity/${slug}`,
      slug,
      name: opts.name ?? "Boulder Creek",
      archetype: opts.archetype ?? "creek",
      hermesProfile: slug,
      pausedAt: opts.paused ? new Date() : null,
      consultationDoneAt: opts.consultationDone === false ? null : new Date("2026-08-01T00:00:00Z"),
    })
    .returning();
  return row!;
}

export async function seedUser(db: TestDb, id: string, email = `${id}@example.org`) {
  const [row] = await db
    .insert(schema.users)
    .values({ id, email: email.toLowerCase(), name: id, ageGateOk: true })
    .returning();
  return row!;
}
