/**
 * Nightly `verifyEventChain` per entity (architecture §10.5). The head hash
 * lands in `config.event_chain_head.<slug>` and from there into
 * `status.json`, so anyone can compare the published head with a SELECT.
 */
import { desc, eq } from "drizzle-orm";
import { verifyEventChain, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { setConfig } from "./common";

export type ChainHead = {
  hash: string | null;
  length: number;
  ok: boolean;
  verified_at: string;
  broken_at?: number;
  reason?: string;
};

export async function runVerifyChain(db: DbOrTx, now = new Date(), slug?: string): Promise<Array<ChainHead & { slug: string }>> {
  const entities = await db.select({ id: schema.entities.id, slug: schema.entities.slug }).from(schema.entities).orderBy(schema.entities.slug);
  const out: Array<ChainHead & { slug: string }> = [];
  for (const e of entities) {
    if (slug && e.slug !== slug) continue;
    const v = await verifyEventChain(db, e.id);
    const [last] = await db.select({ hash: schema.entityEvents.hash }).from(schema.entityEvents).where(eq(schema.entityEvents.entityId, e.id)).orderBy(desc(schema.entityEvents.id)).limit(1);
    const head: ChainHead = v.ok
      ? { hash: last?.hash ?? null, length: v.length, ok: true, verified_at: now.toISOString() }
      : { hash: last?.hash ?? null, length: v.length, ok: false, verified_at: now.toISOString(), broken_at: v.broken_at, reason: v.reason };
    await setConfig(db, `event_chain_head.${e.slug}`, head, now);
    if (!v.ok) console.error(`[verify-chain] ${e.slug}: ${v.reason} at row ${v.broken_at}`);
    out.push({ slug: e.slug, ...head });
  }
  return out;
}
