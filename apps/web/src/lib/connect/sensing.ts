/** Steward sensing setup. Read-only twin validation never changes publication or pause. */
import { sensingCopy as c } from "@/copy/sensing";
import { and, eq } from "drizzle-orm";
import { BindingSchema, bindingSha256, validateBinding } from "@kami/binding";
import { TwinClient } from "@kami/twin-client";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { hatCheck, isPlatformAdmin } from "@/lib/governance/roles";
import { entityBySlug, getConfig, setConfig } from "@/lib/jobs/common";
import { latestSnapshotRow, runNeedsJob, type NeedsJobOptions } from "@/lib/jobs/needs";
export class SensingError extends Error {
}
export class SensingWarnings extends SensingError {
    constructor(public warnings: string[], public warningHash: string) { super(c.warningReview); }
}
export async function mayManageSensing(db: DbOrTx, userId: string, entityId: string) {
    return await isPlatformAdmin(db, userId) || await hatCheck(db, entityId, userId, "steward");
}
async function requireManager(db: DbOrTx, userId: string, entityId: string) {
    if (!await mayManageSensing(db, userId, entityId))
        throw new SensingError(c.forbidden);
}
async function current(db: DbOrTx, entityId: string, version: number | null, lock = false) {
    if (version === null)
        return null;
    const query = db.select().from(schema.entityBindings).where(and(eq(schema.entityBindings.entityId, entityId), eq(schema.entityBindings.bindingVersion, version))).limit(1);
    const [row] = await (lock ? query.for("update") : query);
    return row ?? null;
}
export async function sensingStatus(db: DbOrTx, entity: {
    id: string;
    bindingVersion: number | null;
}) {
    const [row, snapshot] = await Promise.all([current(db, entity.id, entity.bindingVersion), latestSnapshotRow(db, entity.id)]);
    const parsed = BindingSchema.safeParse(row?.binding);
    return { version: entity.bindingVersion, hash: row?.sha256 ?? null, review: row?.review ?? "missing", valid: parsed.success,
        places: parsed.success ? parsed.data.members.map(m => ({ id: m.id, role: m.role })) : [],
        needs: parsed.success ? parsed.data.needs.map(n => ({ need: n.need, property: n.property, places: n.places, aggregation: n.agg })) : [],
        snapshot: snapshot ? { id: snapshot.id, asOf: snapshot.asOf.toISOString(), mood: snapshot.mood } : null };
}
export type SensingStatus = Awaited<ReturnType<typeof sensingStatus>>;
export async function approveSensing(db: DbOrTx, input: {
    slug: string;
    userId: string;
    version: number;
    hash: string;
    acceptedWarningHash?: string;
}, twin = new TwinClient({ baseUrl: "https://data.bioregionaltwin.org", userAgent: "beings.earth/1.0 (steward sensing review)" })) {
    const entity = await entityBySlug(db, input.slug);
    if (!entity)
        throw new SensingError(c.notFound);
    await requireManager(db, input.userId, entity.id);
    const row = await current(db, entity.id, input.version);
    if (entity.bindingVersion !== input.version || !row || row.sha256 !== input.hash || row.review !== "pending_review")
        throw new SensingError(c.changed);
    const parsed = BindingSchema.safeParse(row.binding);
    if (!parsed.success || bindingSha256(row.binding) !== input.hash)
        throw new SensingError(c.checksum);
    const validation = await validateBinding(parsed.data, twin);
    if (!validation.ok)
        throw new SensingError(c.validationFailed(validation.errors.slice(0, 5).map(e => e.message)));
    // A warning requires reviewing the actual issue, not implicit acceptance.
    const warningHash = bindingSha256(validation.warnings);
    if (validation.warnings.length && input.acceptedWarningHash !== warningHash)
        throw new SensingWarnings(validation.warnings.map(e => `${e.path}: ${e.message}`), warningHash);
    await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(schema.entities).where(eq(schema.entities.id, entity.id)).limit(1).for("update");
        await requireManager(tx, input.userId, entity.id);
        const latest = await current(tx, entity.id, input.version, true);
        if (!locked || locked.retiredAt || locked.bindingVersion !== input.version || latest?.sha256 !== input.hash || latest?.review !== "pending_review" || bindingSha256(latest.binding) !== input.hash)
            throw new SensingError(c.changed);
        const approved = { ...parsed.data, reviewed_by: input.userId };
        const hash = bindingSha256(approved);
        const now = new Date();
        await tx.update(schema.entityBindings).set({ binding: approved, sha256: hash, review: "approved", reviewedBy: input.userId, reviewedAt: now }).where(and(eq(schema.entityBindings.entityId, entity.id), eq(schema.entityBindings.bindingVersion, input.version)));
        await appendEntityEvent(tx, { entity_id: entity.id, actor: input.userId, kind: "binding.approved", payload: { binding_version: input.version, previous_sha256: input.hash, sha256: hash, member_count: approved.members.length, validation_warnings: validation.warnings, needs: approved.needs.map(n => n.need) }, at: now });
    });
}
export async function refreshSensing(db: DbOrTx, input: {
    slug: string;
    userId: string;
}, opts: Omit<NeedsJobOptions, "db" | "slug"> = {}) {
    const entity = await entityBySlug(db, input.slug);
    if (!entity)
        throw new SensingError(c.notFound);
    const now = opts.now ?? new Date();
    await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(schema.entities).where(eq(schema.entities.id, entity.id)).limit(1).for("update");
        await requireManager(tx, input.userId, entity.id);
        if (!locked || locked.retiredAt)
            throw new SensingError(c.retired);
        const binding = await current(tx, entity.id, locked.bindingVersion, true);
        if (binding?.review !== "approved")
            throw new SensingError(c.approveFirst);
        const key = `sensing.refresh.${entity.slug}`;
        const previous = await getConfig<{
            at: string;
        }>(tx, key);
        if (previous && now.getTime() - new Date(previous.at).getTime() < 60000)
            throw new SensingError(c.throttled);
        await setConfig(tx, key, { at: now.toISOString(), by: input.userId }, now);
        await appendEntityEvent(tx, { entity_id: entity.id, actor: input.userId, kind: "sensing.refresh_requested", payload: { binding_version: locked.bindingVersion }, at: now });
    });
    const outcome = await runNeedsJob({ db, slug: entity.slug, ...opts, now });
    const result = outcome.results[0];
    if (!result || result.status === "error" || result.status === "skipped")
        throw new SensingError(c.refreshFailed);
    return result;
}
