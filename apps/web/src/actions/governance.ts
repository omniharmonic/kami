"use server";

/**
 * Governance server actions (arch §6.2). Each takes a `FormData` from a plain
 * `<form action={…}>` so every flow works with JavaScript off, then redirects
 * back with `?ok=` or `?error=<code>`.
 */
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { approveBounty, withdrawBounty, type ApproveEdits } from "@/lib/governance/bounties";
import { claimBounty, releaseClaim } from "@/lib/governance/claims";
import { evaluate, type OutcomeName } from "@/lib/governance/evaluations";
import { createHumanProposal } from "@/lib/governance/proposals";
import { pauseEntity, requestResume, retireEntity } from "@/lib/governance/pause";
import { acceptInvite, grantRole, inviteGuardian, revokeRole } from "@/lib/governance/roles";
import { ratifyStrategy, commentOnStrategy } from "@/lib/governance/strategies";
import { GovernanceError } from "@/lib/governance/errors";
import { issueCaptureToken } from "@/lib/evidence/capture-token";
import { activeClaimFor } from "@/lib/governance/claims";
import type { EntityRoleName } from "@/db/schema";
import { actionRedirect, dbOrThrow, formBool, formNumber, formString, requireUserOrThrow } from "./util";

async function slugOf(entityId: string): Promise<string> {
  const db = dbOrThrow();
  const [e] = await db.select({ slug: schema.entities.slug }).from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
  return e?.slug ?? "";
}

// --- bounties --------------------------------------------------------------

/** Guardian approval, optionally with inline edits (never `entity_id` / `twin_refs`). */
export async function approveBountyAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back") || "/guardian";
  return actionRedirect(back, "approved", async () => {
    const user = await requireUserOrThrow();
    const db = dbOrThrow();
    const id = formString(fd, "bounty_id");
    if (!id) throw new GovernanceError("not_found");
    const edits: ApproveEdits = {};
    const title = formString(fd, "title");
    if (title) edits.title = title;
    const why = formString(fd, "why");
    if (why) edits.why = why;
    const deliverable = formString(fd, "deliverable");
    if (deliverable) edits.deliverable = deliverable;
    const tier = formNumber(fd, "verification_tier");
    if (tier !== undefined) edits.verification_tier = tier;
    const cap = formNumber(fd, "cap_usdc");
    if (cap !== undefined) edits.cap_usdc = cap;
    const claimLimit = formNumber(fd, "claim_limit");
    if (claimLimit !== undefined) edits.claim_limit = claimLimit;
    const deadline = formString(fd, "deadline");
    if (deadline) edits.deadline = deadline;
    const evidenceSpec: Record<string, unknown> = {};
    const minPhotos = formNumber(fd, "min_photos");
    if (minPhotos !== undefined) evidenceSpec.min_photos = minPhotos;
    const gps = formString(fd, "gps_within_m");
    if (gps !== "") evidenceSpec.gps_within_m = gps === "none" ? null : Number(gps);
    const second = formNumber(fd, "second_attestation_above_usdc");
    if (second !== undefined) evidenceSpec.second_attestation_above_usdc = second;
    if (fd.has("exif_required")) evidenceSpec.exif_required = formBool(fd, "exif_required");
    if (fd.has("capture_in_app")) evidenceSpec.capture = formBool(fd, "capture_in_app") ? "in_app" : "any";
    if (Object.keys(evidenceSpec).length) edits.evidence_spec = evidenceSpec;
    await approveBounty(db, id, user.id, edits);
    revalidatePath("/guardian");
  });
}

export async function withdrawBountyAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back") || "/guardian";
  return actionRedirect(back, "withdrawn", async () => {
    const user = await requireUserOrThrow();
    await withdrawBounty(dbOrThrow(), formString(fd, "bounty_id"), user.id, formString(fd, "reason") || null);
    revalidatePath("/guardian");
  });
}

// --- claims ----------------------------------------------------------------

export async function claimBountyAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back");
  return actionRedirect(back, "claimed", async () => {
    const user = await requireUserOrThrow();
    await claimBounty(dbOrThrow(), formString(fd, "bounty_id"), user.id);
    revalidatePath(back.split("?")[0] ?? back);
  });
}

export async function releaseClaimAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back");
  return actionRedirect(back, "released", async () => {
    const user = await requireUserOrThrow();
    await releaseClaim(dbOrThrow(), formString(fd, "claim_id"), user.id);
    revalidatePath(back.split("?")[0] ?? back);
  });
}

/** The in-app capture component asks for a short-lived token before opening the camera. */
export async function requestCaptureToken(bountyId: string): Promise<{ token: string; claim_id: string }> {
  const user = await requireUserOrThrow();
  const db = dbOrThrow();
  const claim = await activeClaimFor(db, bountyId, user.id);
  if (!claim) throw new GovernanceError("no_claim");
  return { token: issueCaptureToken(claim.id, user.id), claim_id: claim.id };
}

// --- evaluations -----------------------------------------------------------

export async function evaluateAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back");
  return actionRedirect(back, "evaluated", async () => {
    const user = await requireUserOrThrow();
    const outcome = formString(fd, "outcome") as OutcomeName;
    await evaluate(dbOrThrow(), formString(fd, "submission_id"), user.id, {
      outcome,
      notes: formString(fd, "notes") || null,
      twin_snapshot_hash: formString(fd, "twin_snapshot_hash") || null,
      audit_of: formString(fd, "audit_of") || null,
    });
    revalidatePath(back.split("?")[0] ?? back);
  });
}

// --- human proposals -------------------------------------------------------

export async function proposeAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back");
  return actionRedirect(back, "proposed", async () => {
    const user = await requireUserOrThrow();
    await createHumanProposal(dbOrThrow(), {
      entity_id: formString(fd, "entity_id"),
      author_id: user.id,
      title: formString(fd, "title"),
      body_md: formString(fd, "body_md"),
    });
    revalidatePath(back.split("?")[0] ?? back);
  });
}

function refreshOperationalSnapshot(slug: string) {
  after(async () => {
    try {
      const { runNeedsJob } = await import("@/lib/jobs/needs");
      await runNeedsJob({ db: dbOrThrow(), slug });
      revalidatePath(`/e/${slug}`, "layout");
    } catch {
      console.error("[governance] snapshot refresh failed; current governance state remains authoritative");
    }
  });
}

// --- pause / resume / retire ----------------------------------------------

export async function pauseAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back") || "/guardian";
  return actionRedirect(back, "paused", async () => {
    const user = await requireUserOrThrow();
    const entityId = formString(fd, "entity_id");
    const result = await pauseEntity(dbOrThrow(), entityId, user.id);
    const slug = await slugOf(entityId);
    if (slug) {
      revalidatePath(`/e/${slug}`, "layout");
      if (!result.already) refreshOperationalSnapshot(slug);
    }
    revalidatePath("/guardian");
  });
}

export async function requestResumeAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back") || "/guardian";
  return actionRedirect(back, "resume_requested", async () => {
    const user = await requireUserOrThrow();
    const entityId = formString(fd, "entity_id");
    const result = await requestResume(dbOrThrow(), entityId, user.id);
    const slug = await slugOf(entityId);
    if (slug) {
      revalidatePath(`/e/${slug}`, "layout");
      if (result.resumed) refreshOperationalSnapshot(slug);
    }
    revalidatePath("/guardian");
  });
}

export async function retireAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back") || "/guardian";
  return actionRedirect(back, "retire_requested", async () => {
    const user = await requireUserOrThrow();
    await retireEntity(dbOrThrow(), formString(fd, "entity_id"), user.id);
    revalidatePath("/guardian");
  });
}

// --- roles -----------------------------------------------------------------

export async function inviteGuardianAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back") || "/guardian";
  return actionRedirect(back, "invited", async () => {
    const user = await requireUserOrThrow();
    await inviteGuardian(dbOrThrow(), { entity_id: formString(fd, "entity_id"), email: formString(fd, "email"), invited_by: user.id });
    revalidatePath("/guardian");
  });
}

export async function acceptInviteAction(fd: FormData): Promise<never> {
  const token = formString(fd, "token");
  const back = `/guardian/accept?token=${encodeURIComponent(token)}`;
  return actionRedirect(back, "accepted", async () => {
    const user = await requireUserOrThrow();
    await acceptInvite(dbOrThrow(), token, user.id);
    revalidatePath("/guardian");
  });
}

export async function grantRoleAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back") || "/guardian";
  return actionRedirect(back, "granted", async () => {
    const user = await requireUserOrThrow();
    const db = dbOrThrow();
    const email = formString(fd, "email").toLowerCase();
    const [target] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!target) throw new GovernanceError("not_found", "no account with that email");
    await grantRole(db, { entity_id: formString(fd, "entity_id"), user_id: target.id, role: formString(fd, "role") as EntityRoleName, by: user.id });
    revalidatePath("/guardian");
  });
}

export async function revokeRoleAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back") || "/guardian";
  return actionRedirect(back, "revoked", async () => {
    const user = await requireUserOrThrow();
    await revokeRole(dbOrThrow(), {
      entity_id: formString(fd, "entity_id"),
      user_id: formString(fd, "user_id"),
      role: formString(fd, "role") as EntityRoleName,
      by: user.id,
    });
    revalidatePath("/guardian");
  });
}

// --- strategy --------------------------------------------------------------

export async function commentOnStrategyAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back");
  return actionRedirect(back, "commented", async () => {
    const user = await requireUserOrThrow();
    await commentOnStrategy(dbOrThrow(), formString(fd, "strategy_id"), user.id, formString(fd, "text"));
    revalidatePath(back.split("?")[0] ?? back);
  });
}

export async function ratifyStrategyAction(fd: FormData): Promise<never> {
  const back = formString(fd, "back") || "/guardian";
  return actionRedirect(back, "ratified", async () => {
    const user = await requireUserOrThrow();
    await ratifyStrategy(dbOrThrow(), formString(fd, "strategy_id"), user.id);
    revalidatePath("/guardian");
  });
}
