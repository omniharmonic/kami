import { people } from "@/copy";

export type PersonView = { role: "guardian" | "evaluator" | "steward"; name: string; accepted_at: string | null };

export function People({ roles }: { roles: PersonView[] }) {
  const groups: Array<[string, PersonView[]]> = [
    [people.guardians, roles.filter((r) => r.role === "guardian")],
    [people.evaluators, roles.filter((r) => r.role === "evaluator")],
    [people.stewards, roles.filter((r) => r.role === "steward")],
  ];
  return (
    <section className="section" aria-labelledby="people-h">
      <h2 id="people-h">{people.heading}</h2>
      {roles.length === 0 ? (
        <p className="muted">{people.guardiansEmpty}</p>
      ) : (
        groups.map(([label, list]) =>
          list.length ? (
            <div key={label} style={{ marginBottom: "0.6rem" }}>
              <p className="eyebrow" style={{ margin: "0 0 0.2rem" }}>{label}</p>
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                {list.map((p, i) => (
                  <li key={i}>{p.name}</li>
                ))}
              </ul>
            </div>
          ) : null,
        )
      )}
      <p className="faint" style={{ fontSize: "0.85rem" }}>{people.guardiansNote}</p>
    </section>
  );
}
