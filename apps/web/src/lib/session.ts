/**
 * Session and role helpers (architecture §6.4). Roles are rows in
 * `entity_roles` (accepted, not revoked) plus `users.platform_admin`.
 */
import { cache } from "react";
import { headers } from "next/headers";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import type { EntityRoleName } from "@/db/schema";
import { auth as copy } from "@/copy";
import { getAuth } from "./auth";

export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

export type SessionUser = { id: string; email: string; name: string | null; age_gate_ok: boolean; platform_admin: boolean };

export const getSession = cache(async (): Promise<{ user: SessionUser; expiresAt: Date } | null> => {
  try {
    const auth = getAuth();
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) return null;
    const u = s.user as unknown as Record<string, unknown>;
    return {
      user: {
        id: String(u.id),
        email: String(u.email),
        name: (u.name as string | null) ?? null,
        age_gate_ok: Boolean(u.age_gate_ok ?? u.ageGateOk),
        platform_admin: Boolean(u.platform_admin ?? u.platformAdmin),
      },
      expiresAt: new Date(s.session.expiresAt),
    };
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new AuthError(401, copy.unauthenticated);
  return s.user;
}

export async function hasRole(userId: string, entityId: string, role: EntityRoleName): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const rows = await db
    .select({ role: schema.entityRoles.role })
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

export async function requireRole(entityId: string, role: EntityRoleName): Promise<SessionUser> {
  const user = await requireUser();
  if (user.platform_admin) return user;
  if (!(await hasRole(user.id, entityId, role))) throw new AuthError(403, copy.forbidden);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.platform_admin) throw new AuthError(403, copy.forbidden);
  return user;
}
