/**
 * Upsert notes into the `entities` vault with the fence pattern and index
 * them in `commons_notes` (ADR-E08; plan T1.9). One conflict → re-splice the
 * fresh copy and retry once; a second conflict is reported, never forced.
 *
 * `runCommonsSync` is the weekly job: for every live entity
 *   entity/page    ← entities + souls.voice_md + binding summary
 *   entity/state   ← the last 7 days of pulses (roll-up)
 *   entity/memo    ← strategies (ratified, and the current draft)
 *   entity/report  ← donor_reports.public_md
 *   entity/bounty  ← bounties open/claimed/in_review/paid (spec, state, UIDs)
 * and writes the note path back to `commons_path` where the row has one.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { BindingSchema } from "@kami/binding";
import type { HealthSnapshot } from "@kami/needs";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { env } from "@/env";
import type { Delta } from "@/lib/deltas";
import { isoWeekBounds, isoWeekOf } from "@/lib/mcp/bounty-spec";
import { ConflictError, readPublicNote, type Note, type ParachuteClient } from "./client";
import { fencedBlock, splice } from "./fence";
import { DEFAULT_FRONT_RANGE_BASE } from "./links";
import { entityBounty, entityMemo, entityPage, entityReport, entityState, type EntityRef, type NoteSpec } from "./templates";
import { safeExcerpt } from "./tk-safe";
import { createHash } from "node:crypto";

export type NoteStore = Pick<ParachuteClient, "getNote" | "createNote" | "patchNote">;

export type SyncAction = "created" | "updated" | "unchanged" | "failed";
export type SyncResult = { path: string; kind: NoteSpec["kind"]; action: SyncAction; error?: string };

function sha(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function index(db: DbOrTx | null, spec: NoteSpec, entityId: string | null, vault: string, note: Note | null, content: string, now: Date): Promise<void> {
  if (!db) return;
  await db
    .insert(schema.commonsNotes)
    .values({ path: spec.path, vault, entityId, kind: spec.kind, updatedAtSeen: note?.updated_at ? new Date(note.updated_at) : null, contentSha256: sha(content), lastSyncedAt: now })
    .onConflictDoUpdate({
      target: schema.commonsNotes.path,
      set: { vault, entityId, kind: spec.kind, updatedAtSeen: note?.updated_at ? new Date(note.updated_at) : null, contentSha256: sha(content), lastSyncedAt: now },
    });
}

/** Create or fence-update one note. Metadata on an existing note is merged (ours over theirs, never deleting theirs). */
export async function upsertNote(store: NoteStore, spec: NoteSpec, opts: { db?: DbOrTx | null; entityId?: string | null; vault?: string; now?: Date } = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const vault = opts.vault ?? "entities";
  const db = opts.db ?? null;
  const entityId = opts.entityId ?? null;
  const attempt = async (existing: Note | null): Promise<{ action: SyncAction; note: Note | null; content: string }> => {
    if (!existing) {
      const content = splice(null, spec.block);
      const note = await store.createNote({ path: spec.path, content, tags: spec.tags, metadata: spec.metadata });
      return { action: "created", note, content };
    }
    const content = splice(existing.content, spec.block);
    const metadata = { ...existing.metadata, ...spec.metadata };
    const sameContent = fencedBlock(existing.content) === fencedBlock(content) && existing.content === content;
    const sameMeta = JSON.stringify(stripVolatile(existing.metadata)) === JSON.stringify(stripVolatile(metadata));
    if (sameContent && sameMeta) return { action: "unchanged", note: existing, content };
    const note = await store.patchNote(spec.path, { content, metadata, if_updated_at: existing.updated_at });
    return { action: "updated", note: { ...existing, ...note, content, metadata }, content };
  };
  try {
    let existing = await store.getNote(spec.path);
    let result: Awaited<ReturnType<typeof attempt>>;
    try {
      result = await attempt(existing);
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      existing = err.fresh ?? (await store.getNote(spec.path));
      result = await attempt(existing); // exactly one retry (survey §7.4)
    }
    await index(db, spec, entityId, vault, result.note, result.content, now);
    return { path: spec.path, kind: spec.kind, action: result.action };
  } catch (err) {
    return { path: spec.path, kind: spec.kind, action: "failed", error: (err as Error).message };
  }
}

/** `platform_synced_at` changes every run; it must not by itself force a PATCH. */
function stripVolatile(meta: Record<string, unknown>): Record<string, unknown> {
  const { platform_synced_at, ...rest } = meta;
  void platform_synced_at;
  return Object.fromEntries(Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ---------------------------------------------------------------------------
// the weekly job
// ---------------------------------------------------------------------------

export type CommonsSyncOptions = {
  db: DbOrTx;
  store: NoteStore;
  now?: Date;
  slug?: string;
  vault?: string;
  /** reads the anchor's public commons note for a tkSafe excerpt; defaults to the front-range publication */
  readPublic?: (path: string) => Promise<Note | null>;
  commonsBase?: string;
  pageBase?: string;
};

export type CommonsSyncReport = { as_of: string; results: SyncResult[]; counts: Record<SyncAction, number> };

export async function runCommonsSync(opts: CommonsSyncOptions): Promise<CommonsSyncReport> {
  const now = opts.now ?? new Date();
  const db = opts.db;
  const vault = opts.vault ?? "entities";
  const commonsBase = opts.commonsBase ?? process.env.COMMONS_FRONT_RANGE_BASE_URL ?? DEFAULT_FRONT_RANGE_BASE;
  const pageBase = (opts.pageBase ?? env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const readPublic = opts.readPublic ?? ((path: string) => readPublicNote(commonsBase, path));
  const results: SyncResult[] = [];

  const entities = await db.select().from(schema.entities).where(isNull(schema.entities.retiredAt)).orderBy(schema.entities.slug);
  for (const entity of entities) {
    if (opts.slug && entity.slug !== opts.slug) continue;
    const [bindingRow] = entity.bindingVersion === null
      ? []
      : await db.select().from(schema.entityBindings).where(and(eq(schema.entityBindings.entityId, entity.id), eq(schema.entityBindings.bindingVersion, entity.bindingVersion))).limit(1);
    const parsed = bindingRow ? BindingSchema.safeParse(bindingRow.binding) : null;
    const binding = parsed?.success ? parsed.data : null;
    const ref: EntityRef = { id: entity.id, slug: entity.slug, name: entity.name, archetype: entity.archetype, anchor: binding?.anchor ?? null, binding_version: entity.bindingVersion };

    const [soul] = await db.select().from(schema.souls).where(eq(schema.souls.entityId, entity.id)).orderBy(desc(schema.souls.soulVersion)).limit(1);
    const [snapRow] = await db.select().from(schema.needSnapshots).where(eq(schema.needSnapshots.entityId, entity.id)).orderBy(desc(schema.needSnapshots.asOf)).limit(1);
    const snapshot = (snapRow?.snapshot as HealthSnapshot | undefined) ?? null;

    // entity/page — quote the commons only through tkSafe
    let excerpt: string | null = null;
    if (binding?.anchor) {
      const shelf = (await import("./links")).shelfPathFor(binding.anchor);
      if (shelf) excerpt = safeExcerpt(await readPublic(shelf));
    }
    results.push(
      await upsertNote(
        opts.store,
        entityPage({
          entity: ref,
          voice_md: soul?.voiceMd ?? null,
          members: binding?.members ?? [],
          watersheds: binding?.watersheds ?? [],
          needs: binding?.needs ?? [],
          snapshot,
          page_url: `${pageBase}/e/${entity.slug}`,
          place_excerpt: excerpt,
          now,
          commons_base: commonsBase,
        }),
        { db, entityId: entity.id, vault, now },
      ),
    );

    // entity/state — the week that just ended (Mon→Mon), plus the current week so far
    for (const weekOf of [new Date(now.getTime() - 7 * 86400_000), now]) {
      const { start, end } = isoWeekBounds(weekOf);
      const pulseRows = await db
        .select()
        .from(schema.pulses)
        .where(and(eq(schema.pulses.entityId, entity.id), gte(schema.pulses.at, start), sql`${schema.pulses.at} < ${end}`))
        .orderBy(schema.pulses.at);
      if (!pulseRows.length && weekOf === now) continue;
      results.push(
        await upsertNote(
          opts.store,
          entityState({
            entity: ref,
            week: isoWeekOf(weekOf),
            from: start.toISOString(),
            to: end.toISOString(),
            pulses: pulseRows.map((p) => ({ at: p.at.toISOString(), woke: p.woke, text: p.text, guard_result: p.guardResult, deltas: Array.isArray(p.deltas) ? (p.deltas as Delta[]) : [] })),
            snapshot,
            now,
          }),
          { db, entityId: entity.id, vault, now },
        ),
      );
    }

    // entity/memo
    const strategies = await db.select().from(schema.strategies).where(eq(schema.strategies.entityId, entity.id)).orderBy(desc(schema.strategies.createdAt)).limit(8);
    for (const s of strategies) {
      const spec = entityMemo({ entity: ref, quarter: s.quarter, memo_md: s.memoMd, ratified_at: s.ratifiedAt?.toISOString() ?? null, comment_open_until: s.commentOpenUntil?.toISOString() ?? null, now });
      const r = await upsertNote(opts.store, spec, { db, entityId: entity.id, vault, now });
      results.push(r);
      if (r.action !== "failed" && s.commonsPath !== spec.path) await db.update(schema.strategies).set({ commonsPath: spec.path }).where(eq(schema.strategies.id, s.id));
    }

    // entity/report — only the public half
    const reports = await db.select().from(schema.donorReports).where(and(eq(schema.donorReports.entityId, entity.id), isNotNull(schema.donorReports.publicMd))).orderBy(desc(schema.donorReports.month)).limit(12);
    for (const rep of reports) {
      const spec = entityReport({ entity: ref, month: rep.month, public_md: rep.publicMd ?? "", now });
      const r = await upsertNote(opts.store, spec, { db, entityId: entity.id, vault, now });
      results.push(r);
      if (r.action !== "failed" && rep.commonsPath !== spec.path) await db.update(schema.donorReports).set({ commonsPath: spec.path }).where(eq(schema.donorReports.id, rep.id));
    }

    // entity/bounty — spec, state, UIDs; never claimant PII
    const bounties = await db
      .select()
      .from(schema.bounties)
      .where(and(eq(schema.bounties.entityId, entity.id), inArray(schema.bounties.status, ["open", "claimed", "in_review", "paid"])))
      .orderBy(desc(schema.bounties.createdAt))
      .limit(50);
    for (const b of bounties) {
      const uidRows = await db
        .select({ payoutUid: schema.payouts.easUidCompleted, evalUid: schema.evaluations.easUid })
        .from(schema.claims)
        .innerJoin(schema.submissions, eq(schema.submissions.claimId, schema.claims.id))
        .leftJoin(schema.payouts, eq(schema.payouts.submissionId, schema.submissions.id))
        .leftJoin(schema.evaluations, eq(schema.evaluations.submissionId, schema.submissions.id))
        .where(eq(schema.claims.bountyId, b.id));
      const uids: Array<{ schema: string; uid: string }> = [];
      for (const u of uidRows) {
        if (u.evalUid) uids.push({ schema: "BountyEvaluated", uid: u.evalUid });
        if (u.payoutUid) uids.push({ schema: "BountyCompleted", uid: u.payoutUid });
      }
      const spec = entityBounty({
        entity: ref,
        bounty: {
          id: b.id,
          title: b.title,
          why_md: b.whyMd,
          deliverable_md: b.deliverableMd,
          verification_tier: b.verificationTier,
          evidence_spec: b.evidenceSpec,
          cap_usdc: b.capUsdc,
          claim_limit: b.claimLimit,
          deadline: b.deadline,
          status: b.status,
          twin_refs: b.twinRefs,
          prediction: b.prediction,
          spec_sha256: b.specSha256,
          eas_uid_posted: b.easUidPosted,
          created_at: b.createdAt?.toISOString() ?? null,
        },
        uids,
        now,
        commons_base: commonsBase,
      });
      const r = await upsertNote(opts.store, spec, { db, entityId: entity.id, vault, now });
      results.push(r);
      if (r.action !== "failed" && b.commonsPath !== spec.path) await db.update(schema.bounties).set({ commonsPath: spec.path }).where(eq(schema.bounties.id, b.id));
    }
  }

  const counts: Record<SyncAction, number> = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  for (const r of results) counts[r.action]++;
  return { as_of: now.toISOString(), results, counts };
}

/** An in-memory vault for tests and dry runs; behaves like the hub (409 on double create, 428 without if_updated_at, 412 on a stale one). */
export class MemoryNoteStore implements NoteStore {
  readonly notes = new Map<string, Note>();
  writes = 0;
  constructor(private readonly now: () => number = Date.now) {}
  private tick = 0;
  private stamp(): string {
    this.tick += 1;
    return new Date(this.now() + this.tick).toISOString();
  }
  async getNote(path: string): Promise<Note | null> {
    const n = this.notes.get(path);
    return n ? { ...n, metadata: { ...n.metadata }, tags: [...n.tags] } : null;
  }
  async createNote(input: { path: string; content: string; tags: string[]; metadata: Record<string, unknown> }): Promise<Note> {
    if (this.notes.has(input.path)) throw new ConflictError(await this.getNote(input.path), 409);
    const note: Note = { id: `n_${this.notes.size + 1}`, path: input.path, content: input.content, tags: [...input.tags], metadata: { ...input.metadata }, updated_at: this.stamp() };
    this.notes.set(input.path, note);
    this.writes += 1;
    return { ...note };
  }
  async patchNote(path: string, input: { content?: string; metadata?: Record<string, unknown>; if_updated_at: string | null }): Promise<Note> {
    const cur = this.notes.get(path);
    if (!cur) throw new ConflictError(null, 412);
    if (!input.if_updated_at) throw new ConflictError(await this.getNote(path), 428);
    if (input.if_updated_at !== cur.updated_at) throw new ConflictError(await this.getNote(path), 412);
    const next: Note = { ...cur, content: input.content ?? cur.content, metadata: input.metadata ?? cur.metadata, updated_at: this.stamp() };
    this.notes.set(path, next); // tags untouched: add_tags on PATCH is a no-op on the hub
    this.writes += 1;
    return { ...next };
  }
  /** A human edits the note outside the fence. */
  humanEdit(path: string, mutate: (content: string) => string): void {
    const cur = this.notes.get(path);
    if (!cur) throw new Error(`no note ${path}`);
    this.notes.set(path, { ...cur, content: mutate(cur.content), updated_at: this.stamp() });
  }
}
