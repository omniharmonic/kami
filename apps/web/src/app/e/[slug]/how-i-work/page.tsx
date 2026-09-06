import type { Metadata } from "next";
import { howIWork as copy, errors } from "@/copy";
import { getBinding, getEntityBySlug, getGuardDropRate, getPauseDrills, getPeople, getSoul } from "@/lib/entities";
import { servingModel } from "@/lib/entities";
import { getSession } from "@/lib/session";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  return { title: entity ? copy.heading(entity.name) : errors.notFound };
}

const TWIN_HEALTH = "https://data.bioregionaltwin.org/latest/health.json";

export default async function HowIWorkPage({ params }: Props) {
  const { slug } = await params;
  const entity = (await getEntityBySlug(slug))!;
  const [soul, binding, drills, dropRate, session, people, model] = await Promise.all([
    getSoul(entity.id),
    getBinding(entity.id),
    getPauseDrills(entity.id),
    getGuardDropRate(entity.id),
    getSession(),
    getPeople(entity.id),
    servingModel(entity.slug),
  ]);
  const guardians = people.filter((p) => p.role === "guardian");
  // PRD §13 #4: the consultation record is public only once a steward marks it done.
  // Before that, only a signed-in user sees the placeholder (stewards/admins in later WPs).
  const consultationPublished = entity.consultation_done_at !== null;

  return (
    <div className="stack">
      <h2 style={{ margin: "1rem 0 0" }}>{copy.heading(entity.name)}</h2>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{copy.model}</h3>
        <p style={{ margin: 0 }}>{copy.modelBody}</p>
        {/* G7: the page must name the model. It reads the entity's own profile
            config, so it cannot claim a model that is not the one serving. */}
        <p style={{ margin: "0.4rem 0 0" }} data-testid="model-name">
          {model ? copy.modelName(model.name, model.reasoning_effort) : copy.modelUnknown}
        </p>
        {entity.hermes_profile && <p className="faint" style={{ margin: "0.4rem 0 0" }}>profile: <code>{entity.hermes_profile}</code></p>}
      </section>

      {/* G7: the page must name the guardians — the people who can stop this. */}
      <section className="card">
        <h3 style={{ marginTop: 0 }}>{copy.guardiansHeading}</h3>
        <p style={{ margin: "0 0 0.4rem" }}>{copy.guardiansBody}</p>
        {guardians.length === 0 ? (
          <p className="faint" style={{ margin: 0 }}>{copy.guardiansNone}</p>
        ) : (
          <ul style={{ margin: 0 }} data-testid="guardian-names">
            {guardians.map((g) => (
              <li key={g.name}>{g.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{copy.guard}</h3>
        <p>{copy.guardBody}</p>
        <p className="faint" style={{ margin: 0 }}>{copy.dropRate(dropRate)}</p>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{copy.cadence}</h3>
        <p style={{ margin: 0 }}>{copy.cadenceBody}</p>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{copy.links}</h3>
        <ul style={{ margin: 0 }}>
          <li>
            {copy.soul}
            {soul ? <span className="faint"> — v{soul.version}, hard rules {soul.hard_rules_version}</span> : <span className="faint"> — not published yet</span>}
          </li>
          <li>
            {copy.binding}
            {binding ? <span className="faint"> — v{binding.version}, {binding.review}, sha256 <code>{binding.sha256.slice(0, 12)}…</code></span> : <span className="faint"> — not published yet</span>}
          </li>
          <li>
            <a href={TWIN_HEALTH} rel="noopener">{copy.twinHealth}</a>
          </li>
        </ul>
        {soul && (
          <details style={{ marginTop: "0.6rem" }}>
            <summary className="tap" style={{ cursor: "pointer" }}>SOUL.md (voice)</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{soul.voice_md}</pre>
          </details>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{copy.drill}</h3>
        {drills.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{copy.drillEmpty}</p>
        ) : (
          <ul style={{ margin: 0 }}>
            {drills.map((d, i) => (
              <li key={i}>
                <time dateTime={d.at}>{d.at}</time> · {d.action}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" data-consultation={consultationPublished ? "published" : "unpublished"}>
        <h3 style={{ marginTop: 0 }}>{copy.consultation}</h3>
        {consultationPublished ? (
          <>
            <p className="faint">{copy.consultationDone(entity.consultation_done_at!)}</p>
            <div style={{ whiteSpace: "pre-wrap" }}>{entity.consultation_md ?? ""}</div>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {copy.consultationUnpublished}
            {session ? " (You are signed in; stewards mark it done from the guardian console.)" : ""}
          </p>
        )}
        <p className="faint" style={{ margin: "0.6rem 0 0" }}>{copy.consultationNever}</p>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{copy.noToken}</h3>
        <p style={{ margin: 0 }}>{copy.noTokenBody}</p>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{copy.licences}</h3>
        <ul style={{ margin: 0 }}>
          {copy.licencesBody.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="faint" style={{ margin: "0.6rem 0 0" }}>{copy.voiceNotStanding}</p>
      </section>
    </div>
  );
}
