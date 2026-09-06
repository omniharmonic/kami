import { summon } from "@/lib/summon/copy";

/**
 * The hard rules, rendered read-only from
 * `profiles/templates/SOUL.hard-rules.md`. There is deliberately no form
 * control here and no field name: the block cannot be edited, and the client
 * never sends it back (PRD §4.5).
 */
export function HardRules({ block, version }: { block: string; version: number }) {
  return (
    <section className="section" aria-labelledby="hard-rules-h">
      <h3 id="hard-rules-h" style={{ fontSize: "1rem" }}>
        {summon.soul.hardRulesHeading} <span className="chip">v{version}</span>
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>{summon.soul.hardRulesIntro}</p>
      <p className="faint" style={{ marginTop: "-0.4rem", fontSize: "0.85rem" }}>{summon.soul.hardRulesReadOnly}</p>
      <div
        className="sunken"
        role="region"
        aria-readonly="true"
        aria-label={summon.soul.hardRulesHeading}
        tabIndex={0}
        style={{ maxHeight: "22rem", overflow: "auto" }}
      >
        <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: "0.82rem", lineHeight: 1.5 }}>{block}</pre>
      </div>
    </section>
  );
}
