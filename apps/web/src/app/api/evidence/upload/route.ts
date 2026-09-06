/**
 * POST /api/evidence/upload — the claimant asks for presigned PUTs (arch §6.2,
 * T2.8). Authenticated, and only for a bounty the caller actively holds a claim
 * on. Enforces 50 MB per file and 30 files per submission, records one
 * `evidence_files` row per file with the client-supplied `sha256` (re-verified
 * from the stored bytes at `finalize`), the `in_app_capture` flag (from the
 * signed capture token `Capture.tsx` holds) and `licence_accepted_at`.
 *
 * In development with no R2 credentials the presigned URL points at
 * `/api/evidence/local/[key]`, which writes under `KAMI_DATA_DIR/evidence`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, like, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { verifyCaptureToken } from "@/lib/evidence/capture-token";
import { requireLicenceAccepted } from "@/lib/evidence/licence";
import { evidenceKey, getEvidenceStorage, MAX_FILE_BYTES, MAX_FILES_PER_SUBMISSION } from "@/lib/evidence/storage";
import { GovernanceError } from "@/lib/governance/errors";
import { activeClaimFor } from "@/lib/governance/claims";
import { loadBounty } from "@/lib/governance/bounties";
import { newId } from "@/lib/governance/tx";
import { getSession } from "@/lib/session";
import { govErrors } from "@/copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  bounty_id: z.string().min(1),
  licence_accepted: z.union([z.boolean(), z.literal("on")]).optional(),
  capture_token: z.string().optional(),
  files: z
    .array(
      z.object({
        mime: z.string().min(3).max(100),
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        in_app_capture: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(MAX_FILES_PER_SUBMISSION),
});

export function errorResponse(err: unknown) {
  if (err instanceof GovernanceError) {
    const status = err.code === "unauthenticated" ? 401 : err.code === "forbidden" || err.code === "hat_required" ? 403 : err.code === "not_found" ? 404 : err.code === "paused" || err.code === "retired" ? 423 : 400;
    return NextResponse.json({ error: err.code, message: govErrors[err.code] ?? err.message }, { status });
  }
  console.warn("[evidence] unexpected:", (err as Error)?.message);
  return NextResponse.json({ error: "generic", message: govErrors.generic }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) throw new GovernanceError("unauthenticated");
    const db = getDb();
    if (!db) throw new GovernanceError("no_db");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new GovernanceError("invalid_spec", parsed.error.issues.map((i) => i.path.join(".")).join(", "));
    const input = parsed.data;

    for (const f of input.files) if (f.bytes > MAX_FILE_BYTES) throw new GovernanceError("file_too_large");

    const bounty = await loadBounty(db, input.bounty_id);
    const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, bounty.entityId!)).limit(1);
    if (!entity) throw new GovernanceError("not_found");
    if (entity.retiredAt) throw new GovernanceError("retired");
    if (entity.pausedAt) throw new GovernanceError("paused");

    const claim = await activeClaimFor(db, bounty.id, session.user.id);
    if (!claim) throw new GovernanceError("no_claim");

    const licenceAt = requireLicenceAccepted({ licence_accepted: input.licence_accepted ?? null });

    // 30 files per submission, counting what is already staged for this claim.
    const [staged] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.evidenceFiles)
      .where(and(isNull(schema.evidenceFiles.submissionId), isNull(schema.evidenceFiles.deletedAt), like(schema.evidenceFiles.r2Key, `evidence/${entity.slug}/${claim.id}/%`)));
    if ((staged?.n ?? 0) + input.files.length > MAX_FILES_PER_SUBMISSION) throw new GovernanceError("too_many_files");

    const inApp = verifyCaptureToken(input.capture_token, claim.id, session.user.id);
    const storage = await getEvidenceStorage();

    const out: Array<{ file_id: string; key: string; sha256: string; in_app_capture: boolean; put: Awaited<ReturnType<typeof storage.presignPut>> }> = [];
    for (const f of input.files) {
      const fileId = newId("ev");
      const key = evidenceKey(entity.slug, claim.id, fileId, f.mime);
      const put = await storage.presignPut(key, f.mime, f.bytes);
      await db.insert(schema.evidenceFiles).values({
        id: fileId,
        submissionId: null,
        r2Key: key,
        sha256: f.sha256,
        mime: f.mime,
        bytes: f.bytes,
        inAppCapture: inApp && f.in_app_capture !== false,
        licenceAcceptedAt: licenceAt,
      });
      out.push({ file_id: fileId, key, sha256: f.sha256, in_app_capture: inApp && f.in_app_capture !== false, put });
    }
    return NextResponse.json({
      claim_id: claim.id,
      storage: storage.kind,
      in_app_capture: inApp,
      max_file_bytes: MAX_FILE_BYTES,
      max_files: MAX_FILES_PER_SUBMISSION,
      files: out,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
