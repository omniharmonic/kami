import { Siblings } from "@/components/Siblings";
import { summon } from "@/lib/summon/copy";
import type { SiblingEntity } from "@/lib/summon/siblings";

/**
 * §4.4: "Creating an entity for a place already bound by another entity shows
 * the siblings first." This renders on step 1, immediately after the
 * proposal and before step 2 asks for any effort at all.
 */
export function SiblingsFirst({ siblings, placeName }: { siblings: SiblingEntity[]; placeName: string }) {
  if (siblings.length === 0) return null;
  return (
    <div className="card" style={{ borderColor: "var(--warm)" }}>
      <Siblings siblings={siblings} placeName={placeName} heading={summon.siblings.heading} />
    </div>
  );
}
