import type { Metadata } from "next";
import { landing } from "@/copy";
import {
  listPublicEntities,
  getStatusCached,
  getEntityBySlug,
  getStrategy,
} from "@/lib/entities";
import { WorldExplorer } from "@/components/explore/WorldExplorer";
// Resolve the public registry at request time: build-time credentials and
// fixtures must never freeze an empty world into the deployment.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: landing.title,
  description: landing.tagline,
};
export default async function Landing() {
  const published = await listPublicEntities();
  const entities = await Promise.all(
    published.map(async (entry) => {
      const [status, entity] = await Promise.all([
        getStatusCached(entry.slug),
        getEntityBySlug(entry.slug),
      ]);
      return {
        ...entry,
        snapshot: status?.snapshot ?? null,
        pulses: status?.pulses ?? [],
        strategy: entity ? await getStrategy(entity.id) : null,
      };
    }),
  );
  return <WorldExplorer entities={entities} />;
}
