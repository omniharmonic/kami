/**
 * Finalising a submission (T2.8): re-verify every staged file's sha256 against
 * the stored bytes, parse EXIF, check the files against the bounty's
 * `evidence_spec`, build the `evidence_summary` (the only shape the model ever
 * sees) and move the bounty `claimed → in_review`.
 *
 * Staged files are matched by their `r2_key` prefix `evidence/<slug>/<claim>/`
 * because `evidence_files` has no `claim_id` column (see the report's schema
 * gaps); the prefix is written by the upload route, never by the client.
 */
import { createHash } from "node:crypto";
import { and, eq, isNull, like } from "drizzle-orm";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { exifFromParsed, parseExif, type ParsedExif } from "@/lib/evidence/exif";
import { buildEvidenceSummary, type EvidenceSummary } from "@/lib/evidence/summary";
import { checkAgainstSpec, parseEvidenceSpec, type EvidenceFileFacts, type SpecCheck } from "@/lib/evidence/spec";
import { getEvidenceStorage, type EvidenceStorage } from "@/lib/evidence/storage";
import { bountyAnchor, loadBounty, transitionBounty } from "./bounties";
import { activeClaimFor } from "./claims";
import { GovernanceError } from "./errors";
import { newId, withTx } from "./tx";

export type FinalizeResult = {
  submission_id: string;
  bounty_status: schema.BountyStatus;
  summary: EvidenceSummary;
  spec_check: SpecCheck;
  files: number;
};

export type FinalizeDeps = {
  now?: Date;
  storage?: EvidenceStorage;
  /** test seam: EXIF per r2 key, bypassing the object store */
  exifFor?: (key: string) => Promise<ParsedExif | Record<string, unknown> | null>;
  /** test seam: skip re-hashing the stored bytes */
  skipHashCheck?: boolean;
  anchor?: { lat: number; lon: number } | null;
};

export async function finalizeSubmission(
  db: DbOrTx,
  input: { bounty_id: string; user_id: string; note?: string | null },
  deps: FinalizeDeps = {},
): Promise<FinalizeResult> {
  const now = deps.now ?? new Date();
  const bounty = await loadBounty(db, input.bounty_id);
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, bounty.entityId!)).limit(1);
  if (!entity) throw new GovernanceError("not_found");
  if (entity.retiredAt) throw new GovernanceError("retired");
  if (entity.pausedAt) throw new GovernanceError("paused");
  const claim = await activeClaimFor(db, bounty.id, input.user_id);
  if (!claim) throw new GovernanceError("no_claim");

  const staged = await db
    .select()
    .from(schema.evidenceFiles)
    .where(and(isNull(schema.evidenceFiles.submissionId), isNull(schema.evidenceFiles.deletedAt), like(schema.evidenceFiles.r2Key, `evidence/${entity.slug}/${claim.id}/%`)));
  if (staged.length === 0) throw new GovernanceError("no_files");

  const storage = deps.storage ?? (await getEvidenceStorage());
  const anchor = deps.anchor !== undefined ? deps.anchor : await bountyAnchor(db, entity.id);
  const spec = parseEvidenceSpec(bounty.evidenceSpec);

  const facts: EvidenceFileFacts[] = [];
  const updates: Array<{ id: string; exif: ParsedExif }> = [];
  for (const f of staged) {
    let exif: ParsedExif = { captured_at: null, gps: null, make: null, model: null, present: false };
    if (deps.exifFor) {
      const raw = await deps.exifFor(f.r2Key);
      exif = raw && "present" in (raw as object) ? (raw as ParsedExif) : exifFromParsed((raw as Record<string, unknown>) ?? null);
    } else {
      const bytes = await storage.getObject(f.r2Key);
      if (!bytes) throw new GovernanceError("no_files", `stored object missing for ${f.id}`);
      if (!deps.skipHashCheck) {
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (digest !== f.sha256) throw new GovernanceError("sha_mismatch", `sha256 mismatch for ${f.id}`);
      }
      exif = await parseExif(bytes);
    }
    updates.push({ id: f.id, exif });
    facts.push({
      sha256: f.sha256,
      mime: f.mime,
      bytes: f.bytes,
      captured_at: exif.captured_at,
      gps: exif.gps,
      exif_present: exif.present,
      in_app_capture: f.inAppCapture,
    });
  }

  const spec_check = checkAgainstSpec(facts, spec, { anchor });
  const summary = buildEvidenceSummary(facts, input.note ?? null, { gps_within_m: spec.gps_within_m, anchor, spec_check });

  return withTx(db, async (tx) => {
    const locked = await loadBounty(tx, input.bounty_id, true);
    const submissionId = newId("sub");
    await tx.insert(schema.submissions).values({ id: submissionId, claimId: claim.id, submittedAt: now, noteMd: input.note ?? null, evidenceSummary: summary });
    for (const u of updates) {
      await tx
        .update(schema.evidenceFiles)
        .set({
          submissionId,
          exif: { make: u.exif.make, model: u.exif.model, captured_at: u.exif.captured_at?.toISOString() ?? null, present: u.exif.present },
          capturedAt: u.exif.captured_at,
          gpsLat: u.exif.gps ? String(u.exif.gps.lat) : null,
          gpsLon: u.exif.gps ? String(u.exif.gps.lon) : null,
        })
        .where(eq(schema.evidenceFiles.id, u.id));
    }
    let status = locked.status;
    if (locked.status === "claimed" || locked.status === "open") {
      status = (await transitionBounty(tx, locked, "in_review", input.user_id, { claim_id: claim.id, submission_id: submissionId, spec_ok: spec_check.ok }, now)).status;
    }
    await appendEntityEvent(tx, {
      entity_id: entity.id,
      actor: input.user_id,
      kind: "evidence_submitted",
      payload: {
        bounty_id: bounty.id,
        claim_id: claim.id,
        submission_id: submissionId,
        files: facts.length,
        spec_ok: spec_check.ok,
        failures: spec_check.failures,
        summary: { photo_count: summary.photo_count, exif_ok_count: summary.exif_ok_count, gps_within_spec_count: summary.gps_within_spec_count, in_app_capture_count: summary.in_app_capture_count },
      },
      at: now,
    });
    return { submission_id: submissionId, bounty_status: status, summary, spec_check, files: facts.length };
  });
}

/**
 * A contributor's evidence-deletion request (PRD §13 #7): the file is removed
 * from the object store and marked deleted; the sha256 stays because an
 * attestation may reference it.
 */
export async function requestEvidenceDeletion(db: DbOrTx, userId: string, opts: { file_ids?: string[]; storage?: EvidenceStorage; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ id: schema.evidenceFiles.id, key: schema.evidenceFiles.r2Key, sha256: schema.evidenceFiles.sha256, entityId: schema.bounties.entityId, deletedAt: schema.evidenceFiles.deletedAt })
    .from(schema.evidenceFiles)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.evidenceFiles.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .where(eq(schema.claims.userId, userId));
  const targets = rows.filter((r) => !r.deletedAt && (!opts.file_ids || opts.file_ids.includes(r.id)));
  if (targets.length === 0) return { deleted: 0 };
  const storage = opts.storage ?? (await getEvidenceStorage());
  for (const t of targets) {
    try {
      await storage.deleteObject(t.key);
    } catch (err) {
      console.warn("[evidence] delete failed:", (err as Error).message);
    }
    await db.update(schema.evidenceFiles).set({ deletedAt: now }).where(eq(schema.evidenceFiles.id, t.id));
    if (t.entityId) {
      await appendEntityEvent(db, {
        entity_id: t.entityId,
        actor: userId,
        kind: "evidence_deleted",
        payload: { file_id: t.id, sha256: t.sha256, note: "file removed on request; the hash stays because an attestation may reference it" },
        at: now,
      });
    }
  }
  return { deleted: targets.length };
}
