/**
 * Shared fixtures for the jobs/MCP tests: a PGlite database seeded with a
 * Boulder Creek entity whose binding is the committed
 * `profiles/boulder-creek/binding.yaml`, and a `TwinClient` reading the
 * twin-mcp fixture tree from disk (the sandbox cannot reach the live tree).
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { eq } from "drizzle-orm";
import { BindingSchema, bindingSha256, type Binding } from "@kami/binding";
import { TwinClient } from "@kami/twin-client";
import { createTestDb, seedEntity, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { LocalDirPublisher } from "@/lib/publish";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../../../../..");
export const FIXTURE_TREE = path.join(repoRoot, "packages/twin-mcp/fixtures/public");
export const BINDING_YAML = path.join(repoRoot, "profiles/boulder-creek/binding.yaml");

export const NOW = new Date("2026-09-06T06:00:00Z");

export async function loadBoulderBinding(): Promise<Binding> {
  const text = await fs.readFile(BINDING_YAML, "utf8");
  // YAML dates become Date objects; the schema wants ISO strings.
  const raw = JSON.parse(JSON.stringify(parseYaml(text))) as unknown;
  return BindingSchema.parse(raw) as Binding;
}

export function twinFromFixtures(dir = FIXTURE_TREE, now: () => number = () => NOW.getTime()): TwinClient {
  return new TwinClient({ localDir: dir, userAgent: "kami-web-test/0.1 (tests@kami.invalid)", minIntervalMs: 0, now });
}

const tmpDirs: string[] = [];
export async function tmpDir(prefix = "kami-test-"): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
export async function cleanupTmpDirs(): Promise<void> {
  await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
}

/** A copy of the fixture tree we may mutate (e.g. bump `generated_at`). */
export async function copyFixtureTree(): Promise<string> {
  const dir = await tmpDir("kami-tree-");
  await fs.cp(FIXTURE_TREE, dir, { recursive: true });
  return dir;
}

/** Rewrite every `generated_at` in the tree — the twin does this every cycle (survey §1.1). */
export async function bumpGeneratedAt(dir: string, value: string): Promise<number> {
  let n = 0;
  const walk = async (d: string): Promise<void> => {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!entry.name.endsWith(".json") && !entry.name.endsWith(".geojson")) continue;
      const text = await fs.readFile(p, "utf8");
      if (!text.includes('"generated_at"')) continue;
      await fs.writeFile(p, text.replace(/"generated_at":\s*"[^"]*"/g, `"generated_at":"${value}"`), "utf8");
      n++;
    }
  };
  await walk(dir);
  return n;
}

export type SeededEntity = { db: TestDb; entity: typeof schema.entities.$inferSelect; binding: Binding; publisher: LocalDirPublisher; dataDir: string };

export async function seedBoulderCreek(opts: { db?: TestDb; slug?: string; consultationDone?: boolean;
  review?: "approved" | "pending_review"; paused?: boolean } = {}): Promise<SeededEntity> {
  const db = opts.db ?? (await createTestDb());
  const slug = opts.slug ?? "boulder-creek";
  const binding = await loadBoulderBinding();
  const bound: Binding = { ...binding, entity_id: `entity/${slug}` };
  const row = await seedEntity(db, {
    slug,
    name: slug === "boulder-creek" ? "Boulder Creek" : slug,
    paused: opts.paused ?? false,
    ...(opts.consultationDone === undefined ? {} : { consultationDone: opts.consultationDone }),
  });
  await db.insert(schema.entityBindings).values({
    entityId: row.id,
    bindingVersion: bound.binding_version,
    binding: bound,
    sha256: bindingSha256(bound),
    review: opts.review ?? "approved",
    createdAt: NOW,
  });
  await db.update(schema.entities).set({ bindingVersion: bound.binding_version }).where(eq(schema.entities.id, row.id));
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, row.id));
  const dataDir = await tmpDir("kami-data-");
  return { db, entity: entity!, binding: bound, publisher: new LocalDirPublisher(dataDir), dataDir };
}

export async function readPublishedStatus(publisher: LocalDirPublisher, slug: string): Promise<Record<string, unknown> | null> {
  const obj = await publisher.get(`entity/${slug}/status.json`);
  return obj ? (JSON.parse(obj.body) as Record<string, unknown>) : null;
}
