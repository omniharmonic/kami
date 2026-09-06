import { summon } from "@/lib/summon/copy";
import type { DraftData } from "@/lib/summon/draft";
import { COLOURS, PART_SLOTS } from "@/lib/summon/parts";

/** "Your kami so far" — the running panel every step carries (plan T3.1). */
export function EntitySoFar({ data }: { data: DraftData }) {
  const place = data.place;
  const parts = data.parts?.rive_config;
  const rows: Array<{ label: string; value: string }> = [];
  if (place) {
    rows.push({ label: "Name", value: place.name });
    rows.push({ label: "Address", value: `/e/${place.slug}` });
    rows.push({ label: "Anchor", value: place.binding.anchor });
    rows.push({ label: "Places it senses", value: `${place.binding.members.length}` });
    rows.push({ label: "Needs", value: place.binding.needs.map((n) => n.need).join(", ") });
  }
  if (parts) {
    rows.push({ label: "Archetype", value: parts.archetype });
    rows.push({ label: "Colour", value: COLOURS.find((c) => c.id === parts.colour)?.label ?? parts.colour });
    rows.push({
      label: "Parts",
      value: PART_SLOTS.map((s) => `${s.label.toLowerCase()} ${s.options.find((o) => o.id === parts.parts[s.key])?.label.toLowerCase() ?? "—"}`).join(", "),
    });
  }
  if (data.soul) rows.push({ label: "Voice", value: `${data.soul.voice_md.slice(0, 90)}${data.soul.voice_md.length > 90 ? "…" : ""}` });
  if (data.guardians) rows.push({ label: "Guardians", value: data.guardians.emails.join(", ") });
  if (data.fund) rows.push({ label: "Funding", value: data.fund.skipped ? "skipped for now" : (data.fund.note ?? "noted") });

  return (
    <aside className="card" aria-labelledby="so-far-h" style={{ marginTop: "1.5rem" }}>
      <h2 id="so-far-h" style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>{summon.soFar}</h2>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{summon.soFarEmpty}</p>
      ) : (
        <dl style={{ margin: 0, fontSize: "0.9rem" }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", gap: "0.5rem", padding: "0.15rem 0" }}>
              <dt className="faint" style={{ minWidth: "8.5rem" }}>{r.label}</dt>
              <dd style={{ margin: 0, wordBreak: "break-word" }}>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}
