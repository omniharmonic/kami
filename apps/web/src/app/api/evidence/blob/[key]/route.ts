import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { getSession } from "@/lib/session";
import { boundedBytes, verifyBlobGrant, writeBlobEvidence } from "@/lib/evidence/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Capability is signed by the authenticated claim flow, then ownership is rechecked here. No GET route exposes private evidence. */
export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
  const session = await getSession();
  if (!session) return fail("unauthenticated", 401);
  const key = (await params).key;
  const url = new URL(req.url);
  const grant = { key, mime: url.searchParams.get("mime") ?? "", bytes: Number(url.searchParams.get("bytes")), exp: Number(url.searchParams.get("exp")) };
  if (!verifyBlobGrant(grant, url.searchParams.get("sig"))) return fail("forbidden", 403);
  if (req.headers.get("content-type") !== grant.mime) return fail("mime_mismatch", 400);
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) !== grant.bytes) return fail("size_mismatch", 400);
  const db = getDb();
  if (!db || !process.env.BLOB_READ_WRITE_TOKEN) return fail("storage_unavailable", 503);
  const [, slug, claimId] = key.split("/");
  const [claim] = await db.select({ userId: schema.claims.userId, pausedAt: schema.entities.pausedAt, retiredAt: schema.entities.retiredAt })
    .from(schema.claims).innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId)).innerJoin(schema.entities, eq(schema.entities.id, schema.bounties.entityId))
    .where(and(eq(schema.claims.id, claimId!), eq(schema.entities.slug, slug!), isNull(schema.claims.releasedAt))).limit(1);
  if (!claim || claim.userId !== session.user.id) return fail("forbidden", 403);
  if (claim.pausedAt || claim.retiredAt) return fail("paused", 423);
  const [file] = await db.select().from(schema.evidenceFiles).where(and(eq(schema.evidenceFiles.r2Key, key), isNull(schema.evidenceFiles.submissionId), isNull(schema.evidenceFiles.deletedAt))).limit(1);
  if (!file || file.bytes !== grant.bytes || file.mime !== grant.mime) return fail("forbidden", 403);
  try {
    const bytes = await boundedBytes(req.body, grant.bytes);
    if (bytes.byteLength !== grant.bytes) return fail("size_mismatch", 400);
    await writeBlobEvidence(grant, bytes);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return fail(error instanceof Error && error.message === "file_too_large" ? "file_too_large" : "upload_failed", error instanceof Error && error.message === "file_too_large" ? 413 : 502);
  }
}
