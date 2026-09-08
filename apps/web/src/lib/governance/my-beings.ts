import { asc, eq, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { entities, entityRoles } from "@/db/schema";
import { connectAccess } from "@/lib/connect/access";
import type { SessionUser } from "@/lib/session";

/** Account membership is scoped even for admins; invitations are not membership. */
export async function getMyBeings(db: Db, user: SessionUser) {
  const rows = await db.select().from(entities).where(or(
    eq(entities.createdBy, user.id),
    sql`exists (select 1 from ${entityRoles} where ${entityRoles.entityId} = ${entities.id}
      and ${entityRoles.userId} = ${user.id} and ${entityRoles.acceptedAt} is not null
      and ${entityRoles.revokedAt} is null)`,
  )).orderBy(asc(entities.name));
  return Promise.all(rows.map(async (entity) => ({
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    private: entity.publishedAt === null,
    paused: entity.pausedAt !== null,
    retired: entity.retiredAt !== null,
    access: await connectAccess({ id: entity.id, created_by: entity.createdBy }, user),
  })));
}
