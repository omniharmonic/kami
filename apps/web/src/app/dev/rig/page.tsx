import Link from "next/link";
import { notFound } from "next/navigation";
import { ARCHETYPES, rigManifest } from "@/lib/avatar/rigs";

/** Dev only: index of the per-archetype rig benches. */
export default function RigIndexPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="section">
      <p className="eyebrow">dev · T1.8 acceptance</p>
      <h1>Rig bench</h1>
      <p className="muted">One page per archetype drives every §9.2 input and carries the commissioning checklist.</p>
      <ul className="stack" style={{ paddingLeft: "1rem" }}>
        {ARCHETYPES.map((a) => (
          <li key={a}>
            <Link href={`/dev/rig/${a}`}>{a}</Link>{" "}
            <span className="faint">
              — {rigManifest[a].version}, {rigManifest[a].available ? "rig available" : "SVG fallback authoritative"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
