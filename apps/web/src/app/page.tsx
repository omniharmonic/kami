import type { Metadata } from "next";
import { landing } from "@/copy";
import {
  listPublicEntities,
  getEntityBySlug,
  getStrategy,
} from "@/lib/entities";
import { getSession } from "@/lib/session";
import { getDb } from "@/db/client";
import { getMyBeings } from "@/lib/governance/my-beings";
import { mayPreview } from "@/lib/entity-access";
import { getVisibleEntityDashboard } from "@/lib/entities-private";
import { getVisibleWorldLocation } from "@/lib/world-location";
import { WorldExplorer } from "@/components/explore/WorldExplorer";
// Resolve the public registry at request time: build-time credentials and
// fixtures must never freeze an empty world into the deployment.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: landing.title,
  description: landing.tagline,
};
export default async function Landing() {
  const [published, session] = await Promise.all([listPublicEntities(), getSession()]);
  const db = getDb();
  const mine = db && session ? await getMyBeings(db, session.user) : [];
  const privateEntries = [];
  for (const entry of mine) {
    if (!entry.retired && entry.private && await mayPreview(entry.id)) {
      const entity = await getEntityBySlug(entry.slug);
      if (entity) privateEntries.push({ slug: entity.slug, name: entity.name, archetype: entity.archetype, paused: entity.paused, private: true });
    }
  }
  const entities = await Promise.all(
    [...published.map(entry => ({ ...entry, private: false })), ...privateEntries].map(async (entry) => {
      const [dashboard, location] = await Promise.all([
        getVisibleEntityDashboard(entry.slug), getVisibleWorldLocation(entry.slug),
      ]);
      return {
        ...entry,
        ...location,
        snapshot: dashboard.snapshot,
        pulses: dashboard.status?.pulses ?? [],
        strategy: await getStrategy(dashboard.entity.id),
      };
    }),
  );
  return <WorldExplorer entities={entities} />;
}
