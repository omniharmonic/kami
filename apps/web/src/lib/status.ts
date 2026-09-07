/**
 * status.json — the hourly build ADR-E14 describes: the HealthSnapshot plus the
 * pulse log, a board summary, a treasury summary and `as_of`. Read from
 * `KAMI_DATA_BASE_URL` (the R2 public URL) or `KAMI_DATA_DIR` (a local dir), with
 * `cache: "no-store"`. Never throws: an unreachable or malformed file is `null`
 * and the page says so.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { HealthSnapshot } from "@kami/needs";
import { env } from "@/env";

const needSchema = z.object({
  need: z.enum(["flow", "storage", "snow", "water", "air", "drought", "stage", "fire", "alerts"]),
  place_id: z.string().nullable(),
  property: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  time: z.string().nullable(),
  source_id: z.string().nullable(),
  stale: z.boolean(),
  staleness_s: z.number().nullable(),
  source_status: z.enum(["ok", "warning", "critical", "unknown"]),
  percentile: z.number().nullable(),
  band: z.string().nullable(),
  health: z.number().nullable(),
  trend_7d: z.enum(["rising", "falling", "flat"]).nullable(),
  label: z.string(),
});

export const snapshotSchema = z.object({
  schema_version: z.literal("1.0"),
  entity_id: z.string(),
  as_of: z.string(),
  needs: z.array(needSchema),
  drought_class: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  alert_level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  flood_category: z.enum(["none", "action", "minor", "moderate", "major"]).nullable(),
  stale_driving: z.boolean(),
  mood: z.enum(["asleep", "content", "concerned", "distressed", "celebrating"]),
  mood_reason: z.string(),
  season: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  gpu_online: z.boolean(),
  paused: z.boolean(),
  cosmetics: z.record(z.string(), z.number()),
});

export const pulseEntrySchema = z.object({
  at: z.string(),
  woke: z.boolean(),
  text: z.string().nullable(),
  guard_result: z.enum(["pass", "dropped", "held"]).nullable().optional(),
  deltas: z
    .array(
      z.object({
        kind: z.string(),
        need: z.string().nullable(),
        field: z.string(),
        from: z.unknown(),
        to: z.unknown(),
        notable: z.boolean(),
      }),
    )
    .optional(),
});

export const boardSummarySchema = z.object({
  open: z.number().int().default(0),
  claimed: z.number().int().default(0),
  in_review: z.number().int().default(0),
  paid: z.number().int().default(0),
  human_proposals: z.number().int().default(0),
});

export const treasurySummarySchema = z.object({
  safe_address: z.string().nullable().default(null),
  balance_usdc: z.string().nullable().default(null),
  pending: z.number().int().default(0),
  payouts_total_usdc: z.string().nullable().default(null),
  last_report_month: z.string().nullable().default(null),
});

export const statusEntitySchema = z.object({
  name: z.string(),
  archetype: z.enum(["creek", "watershed", "reservoir", "mountain", "bioregion"]),
  anchor: z.string().nullable().optional(),
});

export const statusFileSchema = z.object({
  schema_version: z.literal("1.0").default("1.0"),
  entity_id: z.string(),
  /** optional: lets a page render with no DB at all */
  entity: statusEntitySchema.optional(),
  as_of: z.string(),
  snapshot: snapshotSchema,
  pulses: z.array(pulseEntrySchema).default([]),
  board: boardSummarySchema.prefault({}),
  treasury: treasurySummarySchema.prefault({}),
});

export type PulseEntry = z.infer<typeof pulseEntrySchema>;
export type BoardSummary = z.infer<typeof boardSummarySchema>;
export type TreasurySummary = z.infer<typeof treasurySummarySchema>;

export type StatusEntity = z.infer<typeof statusEntitySchema>;

export type Status = {
  entity: StatusEntity | null;
  snapshot: HealthSnapshot;
  pulses: PulseEntry[];
  board: BoardSummary;
  treasury: TreasurySummary;
  as_of: string;
};

/** Dev default: the shipped fixture directory. */
export function defaultDataDir(): string {
  return path.join(process.cwd(), "src", "fixtures", "status");
}

export function slugIsValid(slug: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(slug);
}

async function readLocal(dir: string, slug: string): Promise<string | null> {
  const candidates = [path.join(dir, "entity", slug, "status.json"), path.join(dir, `${slug}.json`)];
  for (const file of candidates) {
    try {
      // The data dir is configured at runtime on purpose (KAMI_DATA_DIR); the shipped
      // fixture is traced via next.config `outputFileTracingIncludes`.
      return await fs.readFile(/* turbopackIgnore: true */ file, "utf8");
    } catch {
      // try the next layout
    }
  }
  return null;
}

async function readRemote(base: string, slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/entity/${slug}/status.json`, {
      cache: "no-store",
      headers: { "User-Agent": "kami-web/0.1 (+https://github.com/omniharmonic/kami)" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function parseStatus(text: string): Status | null {
  try {
    const parsed = statusFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const { entity, snapshot, pulses, board, treasury, as_of } = parsed.data;
    return { entity: entity ?? null, snapshot: snapshot as HealthSnapshot, pulses, board, treasury, as_of };
  } catch {
    return null;
  }
}

export async function loadStatus(
  slug: string,
  opts: { dataDir?: string; baseUrl?: string } = {},
): Promise<Status | null> {
  if (!slugIsValid(slug)) return null;
  const baseUrl = opts.baseUrl ?? env.KAMI_DATA_BASE_URL;
  const dataDir = opts.dataDir ?? env.KAMI_DATA_DIR ?? (env.NODE_ENV === "production" ? null : defaultDataDir());
  let text: string | null = null;
  if (baseUrl) text = await readRemote(baseUrl, slug);
  if (text === null && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      // No stale private publication can escape when consultation is removed.
      // Read the current DB record, never a caller-supplied public flag.
      const [{ getDb }, schema, { and, eq, isNotNull, isNull }, { BlobPublisher }] = await Promise.all([
        import("@/db/client"), import("@/db/schema"), import("drizzle-orm"), import("./publish/blob"),
      ]);
      const db = getDb();
      if (!db) return null;
      const [released] = await db.select({ id: schema.entities.id }).from(schema.entities).where(and(eq(schema.entities.slug, slug), isNotNull(schema.entities.consultationDoneAt), isNull(schema.entities.retiredAt))).limit(1);
      if (!released) return null;
      text = (await new BlobPublisher().get(`entity/${slug}/status.json`))?.body ?? null;
    } catch { return null; }
  }
  if (text === null && dataDir) text = await readLocal(dataDir, slug);
  if (text === null) return null;
  return parseStatus(text);
}

/** Slugs with a status file in the local data dir (dev landing page fallback). */
export async function listLocalStatusSlugs(dataDir = env.KAMI_DATA_DIR ?? defaultDataDir()): Promise<string[]> {
  const out = new Set<string>();
  try {
    for (const f of await fs.readdir(/* turbopackIgnore: true */ dataDir)) if (f.endsWith(".json")) out.add(f.replace(/\.json$/, ""));
  } catch {
    /* no dir */
  }
  try {
    for (const d of await fs.readdir(/* turbopackIgnore: true */ path.join(dataDir, "entity"))) out.add(d);
  } catch {
    /* no dir */
  }
  return [...out].filter(slugIsValid).sort();
}

/** Hours between `as_of` and now, for "my senses are N hours behind". */
export function hoursBehind(asOf: string, now = new Date()): number {
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((now.getTime() - t) / 3_600_000));
}
