/**
 * Plurality (PRD §4.4, §13 #10). Many kami for one creek are allowed and
 * expected; the platform's job is to make that visible *before* a creator
 * invests any effort, and to refuse the framing that any one of them is
 * "the" voice.
 *
 * A sibling is any non-retired entity whose current binding has the same
 * `anchor`. Steward and guardians are shown by name, because "who tends this
 * one" is the difference between siblings, not the readings.
 */
import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { withDb } from "@/db/client";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";

export type SiblingPerson = { name: string; user_id: string };

export type SiblingEntity = {
  slug: string;
  name: string;
  archetype: string;
  anchor: string;
  steward: SiblingPerson | null;
  guardians: SiblingPerson[];
  paused: boolean;
  /** the entity's page; null while it is unpublished */
  href: string;
};

function displayName(name: string | null, email: string, userId: string): string {
  if (name && name.trim()) return name.trim();
  // Never render a full address in a public list: the local part is enough to
  // tell two stewards apart.
  const local = email.split("@")[0];
  return local && local.length > 0 ? `${local}@…` : userId;
}

/** Entities bound to `anchor`, excluding `exceptEntityId`. Empty when the DB is unreachable. */
export async function siblingsForAnchor(anchor: string, exceptEntityId?: string | null, db?: DbOrTx): Promise<SiblingEntity[]> {
  const run = async (d: DbOrTx): Promise<SiblingEntity[]> => {
    if (!anchor) return [];
    const conds = [isNull(schema.entities.retiredAt), sql`${schema.entityBindings.binding} ->> 'anchor' = ${anchor}`];
    if (exceptEntityId) conds.push(ne(schema.entityBindings.entityId, exceptEntityId));
    const rows = await d
      .selectDistinct({
        id: schema.entities.id,
        slug: schema.entities.slug,
        name: schema.entities.name,
        archetype: schema.entities.archetype,
        pausedAt: schema.entities.pausedAt,
      })
      .from(schema.entityBindings)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.entityBindings.entityId))
      .where(and(...conds))
      .orderBy(schema.entities.slug);
    if (rows.length === 0) return [];

    const people = await d
      .select({
        entityId: schema.entityRoles.entityId,
        role: schema.entityRoles.role,
        userId: schema.users.id,
        userName: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.entityRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.entityRoles.userId))
      .where(and(isNotNull(schema.entityRoles.acceptedAt), isNull(schema.entityRoles.revokedAt)));

    return rows.map((r) => {
      const mine = people.filter((p) => p.entityId === r.id);
      const steward = mine.find((p) => p.role === "steward");
      return {
        slug: r.slug,
        name: r.name,
        archetype: r.archetype,
        anchor,
        steward: steward ? { name: displayName(steward.userName, steward.email, steward.userId), user_id: steward.userId } : null,
        guardians: mine
          .filter((p) => p.role === "guardian")
          .map((p) => ({ name: displayName(p.userName, p.email, p.userId), user_id: p.userId }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        paused: r.pausedAt !== null,
        href: `/e/${r.slug}`,
      };
    });
  };
  if (db) return run(db);
  return withDb(run, []);
}

/** The anchor of an entity's newest binding (any review state). */
export async function anchorOf(entityId: string, db?: DbOrTx): Promise<string | null> {
  const run = async (d: DbOrTx) => {
    const [row] = await d
      .select({ binding: schema.entityBindings.binding })
      .from(schema.entityBindings)
      .where(eq(schema.entityBindings.entityId, entityId))
      .orderBy(desc(schema.entityBindings.bindingVersion))
      .limit(1);
    const anchor = (row?.binding as { anchor?: string } | undefined)?.anchor;
    return typeof anchor === "string" ? anchor : null;
  };
  if (db) return run(db);
  return withDb(run, null);
}

/** Siblings of an existing entity, for the entity page. */
export async function siblingsOf(entityId: string, db?: DbOrTx): Promise<SiblingEntity[]> {
  const anchor = await anchorOf(entityId, db);
  if (!anchor) return [];
  return siblingsForAnchor(anchor, entityId, db);
}
