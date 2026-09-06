/**
 * entity_events — the append-only, hash-chained audit log (Appendix B, §10.5).
 *
 * hash = sha256( (prev_hash ?? "") || canonical(row) )
 * where canonical(row) is a key-sorted JSON encoding of
 * { entity_id, at, actor, kind, payload, prev_hash }. `at` is set by the app
 * (not the column default) so the hash covers it and anyone can recompute.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { entityEvents } from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = PgTransaction<PgQueryResultHKT, typeof schema, any>;
export type DbOrTx = Db | Tx;

export type EntityEventInput = {
  entity_id: string;
  actor: string | null;
  kind: string;
  payload: Record<string, unknown>;
  /** defaults to now; exposed for deterministic tests */
  at?: Date;
};

export type EntityEventRow = {
  id: number;
  entity_id: string;
  at: Date;
  actor: string | null;
  kind: string;
  payload: unknown;
  prev_hash: string | null;
  hash: string;
};

/** Stable JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function canonicalEventRow(row: {
  entity_id: string;
  at: Date;
  actor: string | null;
  kind: string;
  payload: unknown;
  prev_hash: string | null;
}): string {
  return canonicalJson({
    entity_id: row.entity_id,
    at: row.at.toISOString(),
    actor: row.actor,
    kind: row.kind,
    payload: row.payload,
    prev_hash: row.prev_hash,
  });
}

export function eventHash(prevHash: string | null, canonicalRow: string): string {
  return createHash("sha256")
    .update(prevHash ?? "")
    .update(canonicalRow)
    .digest("hex");
}

/**
 * Append one event inside a transaction. Serialises per entity with an advisory
 * lock so two concurrent appends cannot both read the same `prev_hash`.
 */
export async function appendEntityEvent(tx: DbOrTx, input: EntityEventInput): Promise<EntityEventRow> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.entity_id}))`);
  const [last] = await tx
    .select({ hash: entityEvents.hash })
    .from(entityEvents)
    .where(eq(entityEvents.entityId, input.entity_id))
    .orderBy(desc(entityEvents.id))
    .limit(1);
  const prev_hash = last?.hash ?? null;
  const at = input.at ?? new Date();
  const canonical = canonicalEventRow({
    entity_id: input.entity_id,
    at,
    actor: input.actor,
    kind: input.kind,
    payload: input.payload,
    prev_hash,
  });
  const hash = eventHash(prev_hash, canonical);
  const [row] = await tx
    .insert(entityEvents)
    .values({
      entityId: input.entity_id,
      at,
      actor: input.actor,
      kind: input.kind,
      payload: input.payload,
      prevHash: prev_hash,
      hash,
    })
    .returning();
  if (!row) throw new Error("entity_events insert returned no row");
  return toRow(row);
}

export type ChainVerification =
  | { ok: true; length: number }
  | { ok: false; length: number; broken_at: number; reason: "prev_hash_mismatch" | "hash_mismatch" };

/** Recompute the chain for one entity from the first row. */
export async function verifyEventChain(db: DbOrTx, entity_id: string): Promise<ChainVerification> {
  const rows = await db
    .select()
    .from(entityEvents)
    .where(eq(entityEvents.entityId, entity_id))
    .orderBy(asc(entityEvents.id));
  let prev: string | null = null;
  for (const raw of rows) {
    const row = toRow(raw);
    if (row.prev_hash !== prev) {
      return { ok: false, length: rows.length, broken_at: row.id, reason: "prev_hash_mismatch" };
    }
    const expected = eventHash(row.prev_hash, canonicalEventRow(row));
    if (expected !== row.hash) {
      return { ok: false, length: rows.length, broken_at: row.id, reason: "hash_mismatch" };
    }
    prev = row.hash;
  }
  return { ok: true, length: rows.length };
}

export async function listEntityEvents(db: DbOrTx, entity_id: string, where?: SQL): Promise<EntityEventRow[]> {
  const rows = await db
    .select()
    .from(entityEvents)
    .where(where ? and(eq(entityEvents.entityId, entity_id), where) : eq(entityEvents.entityId, entity_id))
    .orderBy(asc(entityEvents.id));
  return rows.map(toRow);
}

function toRow(r: typeof entityEvents.$inferSelect): EntityEventRow {
  return {
    id: r.id,
    entity_id: r.entityId ?? "",
    at: r.at ?? new Date(0),
    actor: r.actor,
    kind: r.kind,
    payload: r.payload,
    prev_hash: r.prevHash,
    hash: r.hash,
  };
}
