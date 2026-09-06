/**
 * Roles: the DB row is the invitation, the hat is the authority (arch §6.4).
 * Invites, acceptance, revocation, the phase-2 `hatCheck` hook, and the G8 rule.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import type { EntityRoleName } from "@/db/schema";
import { guardian as copy } from "@/copy";
import { CONFIG_DEFAULTS, getConfigNumber } from "./config";
import { GovernanceError } from "./errors";

// --- hat check -------------------------------------------------------------

export type HatResolver = (hatId: string, wearer: { user_id: string; wallet_address: string | null }) => Promise<boolean>;

let hatResolver: HatResolver | null = null;

/**
 * Phase 2 wires Hats' `isWearerOfHat` here (cached ≤ 1 h) — *verify*
 * docs/verify.md #10. Until a resolver is set, a role row that carries a
 * `hat_id` fails closed: the invitation exists but the authority is unproven.
 */
export function setHatResolver(resolver: HatResolver | null): void {
  hatResolver = resolver;
}

export async function hatCheck(db: DbOrTx, entityId: string, userId: string, role: EntityRoleName): Promise<boolean> {
  const [row] = await db
    .select({ hatId: schema.entityRoles.hatId, wallet: schema.users.walletAddress })
    .from(schema.entityRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.entityRoles.userId))
    .where(
      and(
        eq(schema.entityRoles.entityId, entityId),
        eq(schema.entityRoles.userId, userId),
        eq(schema.entityRoles.role, role),
        isNotNull(schema.entityRoles.acceptedAt),
        isNull(schema.entityRoles.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return false;
  if (row.hatId === null || row.hatId === undefined) return true;
  if (!hatResolver) {
    console.warn(`[roles] hat ${row.hatId} recorded for ${userId} but no on-chain resolver is set (*verify*); refusing`);
    return false;
  }
  try {
    return await hatResolver(String(row.hatId), { user_id: userId, wallet_address: row.wallet });
  } catch (err) {
    console.warn("[roles] hat resolver failed:", (err as Error).message);
    return false;
  }
}

// --- role queries ----------------------------------------------------------

export async function isPlatformAdmin(db: DbOrTx, userId: string): Promise<boolean> {
  const [u] = await db.select({ admin: schema.users.platformAdmin }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return Boolean(u?.admin);
}

export async function hasAcceptedRole(db: DbOrTx, userId: string, entityId: string, role: EntityRoleName): Promise<boolean> {
  const rows = await db
    .select({ r: schema.entityRoles.role })
    .from(schema.entityRoles)
    .where(
      and(
        eq(schema.entityRoles.userId, userId),
        eq(schema.entityRoles.entityId, entityId),
        eq(schema.entityRoles.role, role),
        isNotNull(schema.entityRoles.acceptedAt),
        isNull(schema.entityRoles.revokedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Role row (accepted, not revoked) + hat check; platform admins pass. Throws `forbidden` / `hat_required`. */
export async function requireEntityRole(db: DbOrTx, userId: string, entityId: string, roles: EntityRoleName[]): Promise<EntityRoleName | "platform_admin"> {
  if (await isPlatformAdmin(db, userId)) return "platform_admin";
  for (const role of roles) {
    if (await hasAcceptedRole(db, userId, entityId, role)) {
      if (!(await hatCheck(db, entityId, userId, role))) throw new GovernanceError("hat_required");
      return role;
    }
  }
  throw new GovernanceError("forbidden");
}

export async function listRolesForUser(db: DbOrTx, userId: string) {
  return db
    .select({
      entityId: schema.entityRoles.entityId,
      role: schema.entityRoles.role,
      slug: schema.entities.slug,
      name: schema.entities.name,
      pausedAt: schema.entities.pausedAt,
      retiredAt: schema.entities.retiredAt,
      createdBy: schema.entities.createdBy,
    })
    .from(schema.entityRoles)
    .innerJoin(schema.entities, eq(schema.entities.id, schema.entityRoles.entityId))
    .where(and(eq(schema.entityRoles.userId, userId), isNotNull(schema.entityRoles.acceptedAt), isNull(schema.entityRoles.revokedAt)));
}

/** PRD G8: two guardians who are not the founder have accepted. */
export async function entityHasTwoNonFounderGuardians(db: DbOrTx, entityId: string): Promise<boolean> {
  const [e] = await db.select({ createdBy: schema.entities.createdBy }).from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
  if (!e) return false;
  const conds = [
    eq(schema.entityRoles.entityId, entityId),
    eq(schema.entityRoles.role, "guardian" as const),
    isNotNull(schema.entityRoles.acceptedAt),
    isNull(schema.entityRoles.revokedAt),
  ];
  if (e.createdBy) conds.push(ne(schema.entityRoles.userId, e.createdBy));
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.entityRoles).where(and(...conds));
  return (r?.n ?? 0) >= 2;
}

// --- invites ---------------------------------------------------------------

export type SendInviteMail = (args: { email: string; url: string; entityName: string }) => Promise<void>;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resend when `RESEND_API_KEY` is set, else the link goes to the server log (as magic links do). */
export const defaultSendInviteMail: SendInviteMail = async ({ email, url, entityName }) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[roles] guardian invite for ${email} (${entityName}): ${url}`);
    return;
  }
  const { Resend } = await import("resend");
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Kami <hello@kami.local>",
    to: email,
    subject: copy.mailSubject(entityName),
    text: copy.mailBody(entityName, url),
  });
  if (error) throw new Error(`resend: ${error.message}`);
};

export async function inviteGuardian(
  db: DbOrTx,
  input: { entity_id: string; email: string; invited_by: string; base_url?: string },
  deps: { sendMail?: SendInviteMail; now?: Date; token?: string } = {},
): Promise<{ id: string; token: string; expires_at: Date; mailed: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new GovernanceError("invalid_spec", "invalid email");
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, input.entity_id)).limit(1);
  if (!entity) throw new GovernanceError("not_found");
  await requireEntityRole(db, input.invited_by, input.entity_id, ["guardian", "steward"]);
  const now = deps.now ?? new Date();
  const days = await getConfigNumber(db, "invite_days", CONFIG_DEFAULTS.invite_days);
  const token = deps.token ?? randomBytes(32).toString("base64url");
  const id = `inv_${randomBytes(8).toString("hex")}`;
  const expires_at = new Date(now.getTime() + days * 86_400_000);
  await db.insert(schema.guardianInvites).values({ id, entityId: input.entity_id, email, tokenHash: hashToken(token), expiresAt: expires_at });
  await appendEntityEvent(db, {
    entity_id: input.entity_id,
    actor: input.invited_by,
    kind: "guardian_invited",
    payload: { invite_id: id, email_sha256: hashToken(email), expires_at: expires_at.toISOString() },
    at: now,
  });
  const base = input.base_url ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const url = `${base.replace(/\/$/, "")}/guardian/accept?token=${encodeURIComponent(token)}`;
  const mailed = Boolean(process.env.RESEND_API_KEY) || Boolean(deps.sendMail);
  await (deps.sendMail ?? defaultSendInviteMail)({ email, url, entityName: entity.name });
  return { id, token, expires_at, mailed };
}

export async function acceptInvite(db: DbOrTx, token: string, userId: string, deps: { now?: Date } = {}) {
  const now = deps.now ?? new Date();
  const [inv] = await db.select().from(schema.guardianInvites).where(eq(schema.guardianInvites.tokenHash, hashToken(token))).limit(1);
  if (!inv || !inv.entityId) throw new GovernanceError("invite_invalid");
  if (inv.acceptedUserId) throw new GovernanceError("invite_invalid", "already accepted");
  if (!inv.expiresAt || inv.expiresAt.getTime() < now.getTime()) throw new GovernanceError("invite_expired");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new GovernanceError("unauthenticated");
  if (inv.email && inv.email !== user.email.toLowerCase()) throw new GovernanceError("invite_email_mismatch");

  await db
    .insert(schema.entityRoles)
    .values({ entityId: inv.entityId, userId, role: "guardian", invitedAt: now, acceptedAt: now })
    .onConflictDoUpdate({
      target: [schema.entityRoles.entityId, schema.entityRoles.userId, schema.entityRoles.role],
      set: { acceptedAt: now, revokedAt: null },
    });
  await db.update(schema.guardianInvites).set({ acceptedUserId: userId }).where(eq(schema.guardianInvites.id, inv.id));
  await appendEntityEvent(db, { entity_id: inv.entityId, actor: userId, kind: "role_accepted", payload: { role: "guardian", invite_id: inv.id }, at: now });
  const [entity] = await db.select({ name: schema.entities.name, slug: schema.entities.slug }).from(schema.entities).where(eq(schema.entities.id, inv.entityId)).limit(1);
  return { entity_id: inv.entityId, entity_name: entity?.name ?? inv.entityId, slug: entity?.slug ?? "" };
}

/** Evaluators and stewards are added directly by a steward (or admin); guardians arrive by invite. */
export async function grantRole(db: DbOrTx, input: { entity_id: string; user_id: string; role: EntityRoleName; by: string }, deps: { now?: Date } = {}) {
  const now = deps.now ?? new Date();
  await requireEntityRole(db, input.by, input.entity_id, ["steward", "guardian"]);
  await db
    .insert(schema.entityRoles)
    .values({ entityId: input.entity_id, userId: input.user_id, role: input.role, invitedAt: now, acceptedAt: now })
    .onConflictDoUpdate({ target: [schema.entityRoles.entityId, schema.entityRoles.userId, schema.entityRoles.role], set: { acceptedAt: now, revokedAt: null } });
  await appendEntityEvent(db, { entity_id: input.entity_id, actor: input.by, kind: "role_granted", payload: { role: input.role, user_id: input.user_id }, at: now });
}

export async function revokeRole(db: DbOrTx, input: { entity_id: string; user_id: string; role: EntityRoleName; by: string; reason?: string }, deps: { now?: Date } = {}) {
  const now = deps.now ?? new Date();
  await requireEntityRole(db, input.by, input.entity_id, ["steward", "guardian"]);
  const res = await db
    .update(schema.entityRoles)
    .set({ revokedAt: now })
    .where(and(eq(schema.entityRoles.entityId, input.entity_id), eq(schema.entityRoles.userId, input.user_id), eq(schema.entityRoles.role, input.role), isNull(schema.entityRoles.revokedAt)))
    .returning();
  if (res.length === 0) throw new GovernanceError("not_found");
  await appendEntityEvent(db, { entity_id: input.entity_id, actor: input.by, kind: "role_revoked", payload: { role: input.role, user_id: input.user_id, reason: input.reason ?? null }, at: now });
}

export async function listPendingInvites(db: DbOrTx, entityId: string, now = new Date()) {
  return db
    .select({ id: schema.guardianInvites.id, email: schema.guardianInvites.email, expiresAt: schema.guardianInvites.expiresAt })
    .from(schema.guardianInvites)
    .where(and(eq(schema.guardianInvites.entityId, entityId), isNull(schema.guardianInvites.acceptedUserId), gt(schema.guardianInvites.expiresAt, now)));
}
