/** Rendering-only public place coordinates. Never include these in agent context. */
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { BindingSchema } from "@kami/binding";
import { withDb } from "@/db/client";
import { entities, entityBindings } from "@/db/schema";
import { requireVisibleEntity } from "@/lib/entity-access";
import { twinFor } from "@/lib/summon/twin";

export const getVisibleWorldLocation = cache(async (slug: string): Promise<{ longitude: number; latitude: number } | null> => {
  const { entity } = await requireVisibleEntity(slug);
  // Species homes are artistic: never reveal sensitive wildlife locations.
  if (!["creek", "watershed", "reservoir", "forest", "mountain"].includes(entity.archetype)) return null;
  return withDb(async (db) => {
    const [row] = await db.select({ binding: entityBindings.binding }).from(entityBindings)
      .innerJoin(entities, and(eq(entities.id, entityBindings.entityId), eq(entities.bindingVersion, entityBindings.bindingVersion)))
      .where(and(eq(entities.id, entity.id), eq(entityBindings.review, "approved"))).limit(1);
    const binding = BindingSchema.safeParse(row?.binding);
    if (!binding.success) return null;
    try {
      const twin = await twinFor(slug);
      const identity = await twin.idRecord(binding.data.anchor);
      if (identity?.data.sensitivity !== "public") return null;
      const page = await twin.placePage(binding.data.anchor);
      const point = page?.data.centroid;
      if (!point || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return null;
      return { longitude: point[0], latitude: point[1] };
    } catch { return null; }
  }, null);
});
