/**
 * POST /api/evidence/finalize — the claimant has PUT every file; build the
 * `submissions` row and its `evidence_summary`, run `checkAgainstSpec`, and
 * move the bounty to `in_review` (T2.8).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { GovernanceError } from "@/lib/governance/errors";
import { finalizeSubmission } from "@/lib/governance/submissions";
import { NOTE_MAX_CHARS } from "@/lib/evidence/summary";
import { getSession } from "@/lib/session";
import { errorResponse } from "../upload/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  bounty_id: z.string().min(1),
  // The note is sanitised again in buildEvidenceSummary; this only bounds the payload.
  note: z.string().max(NOTE_MAX_CHARS * 4).nullish(),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) throw new GovernanceError("unauthenticated");
    const db = getDb();
    if (!db) throw new GovernanceError("no_db");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new GovernanceError("invalid_spec");
    const result = await finalizeSubmission(db, { bounty_id: parsed.data.bounty_id, user_id: session.user.id, note: parsed.data.note ?? null });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
