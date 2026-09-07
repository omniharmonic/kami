"use client";
import { Landscape } from "@/components/world/Landscape";
export function EntityHabitat({
  name,
  kind,
  slug,
  mood,
  longitude,
  latitude,
}: {
  name: string;
  kind: string;
  slug: string;
  mood: string;
  longitude?: number;
  latitude?: number;
}) {
  return (
    <div
      className="entity-habitat"
      aria-label={`Illustrated digital home for ${name}`}
    >
      <Landscape
        beings={[{ id: slug, name, kind, status: mood, longitude, latitude }]}
        selected={slug}
        habitat
      />
    </div>
  );
}
