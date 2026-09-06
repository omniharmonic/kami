import { notFound } from "next/navigation";
import { isArchetype } from "@/lib/avatar/rigs";
import { RigBench } from "./RigBench";

type Props = { params: Promise<{ archetype: string }> };

/**
 * /dev/rig/<archetype> — the T1.8 acceptance checklist page. Dev only: in
 * production it is a 404. Drives every §9.2 input by hand, shows the SVG
 * fallback and the Rive rig when one is available, and keeps the checklist
 * ticks in localStorage per archetype.
 */
export default async function RigPage({ params }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { archetype } = await params;
  if (!isArchetype(archetype)) notFound();
  return <RigBench archetype={archetype} />;
}
