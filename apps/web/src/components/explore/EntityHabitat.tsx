"use client";
import { Landscape } from "@/components/world/Landscape";
export function EntityHabitat({
  name,
  kind,
  slug,
  mood,
}: {
  name: string;
  kind: string;
  slug: string;
  mood: string;
}) {
  return (
    <div
      className="entity-habitat"
      aria-label={`Illustrated digital home for ${name}`}
    >
      <Landscape
        beings={[{ id: slug, name, kind, status: mood }]}
        selected={slug}
        habitat
      />
    </div>
  );
}
