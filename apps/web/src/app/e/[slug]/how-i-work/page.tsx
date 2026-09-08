import type { Metadata } from "next";
import { howIWork as copy, errors, humanDuration } from "@/copy";
import { getBinding, getEntityBySlug, getGuardDropRate, getPauseDrills, getPeople, getSoul } from "@/lib/entities";
import { requireVisibleEntity } from "@/lib/entity-access";
import { servingProvenance, type Provenance } from "@/lib/provenance";
import { getSession } from "@/lib/session";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  return { title: entity ? copy.heading(entity.name) : errors.notFound };
}

const TWIN_HEALTH = "https://data.bioregionaltwin.org/latest/health.json";

/** What the page may say about the model itself, given what was reported. */
function modelSentence(p: Provenance): string {
  if (p.source === "gate") return p.model ? copy.modelServing(p.model) : copy.modelServingUnnamed;
  if (p.source === "profile") return copy.modelFromProfile(p.model ?? "", p.reasoning_effort ?? "");
  return copy.modelUnknown;
}

/**
 * What the page may say about *whose machine* it runs on. Only a fresh gate
 * report in `owned`/`rented` earns the "no frontier model is on the hot path"
 * claim (see `mayClaimNoFrontierModel`); a stale report is rendered in the past
 * tense beside its timestamp; anything else says nothing.
 */
function placementSentence(p: Provenance): string | null {
  if (p.placement === null) return p.source === "gate" ? copy.modelPlacementUnreported : null;
  if (p.stale) {
    if (p.placement === "owned") return copy.modelOwnedLast(p.provider);
    if (p.placement === "rented") return copy.modelRentedLast(p.provider);
    return copy.modelHostedLast(p.provider);
  }
  if (p.placement === "owned") return copy.modelOwned(p.provider);
  if (p.placement === "rented") return copy.modelRented(p.provider);
  return copy.modelHosted(p.provider);
}

export default async function HowIWorkPage({ params }: Props) {
  const { slug } = await params;
  const { entity } = await requireVisibleEntity(slug);
  const [soul, binding, drills, dropRate, session, people, provenance] = await Promise.all([
    getSoul(entity.id),
    getBinding(entity.id),
    getPauseDrills(entity.id),
    getGuardDropRate(entity.id),
    getSession(),
    getPeople(entity.id),
    servingProvenance(entity.slug),
  ]);
  const placement = placementSentence(provenance);
  const guardians = people.filter((p) => p.role === "guardian");
  // Consultation is optional and independent of publication. Share only a
  // completed record; unfinished relationship notes remain private.
  const consultationPublished = entity.consultation_done_at !== null;

  return (
    <div className="stack">
      <h2 style={{ margin: "1rem 0 0" }}>{copy.heading(entity.name)}</h2>

      {/* G7: the page must name the model. Every sentence below is rendered from
          the gate's provenance report (or from its absence) — nothing here is
          asserted, so the page cannot claim local inference on a day a hosted
          API is answering. */}
      <section className="card" data-provenance={provenance.source} data-placement={provenance.placement ?? "unreported"}>
        <h3 style={{ marginTop: 0 }}>{copy.model}</h3>
        <p style={{ margin: 0 }}>{copy.modelBody}</p>
        <p style={{ margin: "0.4rem 0 0" }} data-testid="model-name">{modelSentence(provenance)}</p>
        {placement && (
          <p style={{ margin: "0.4rem 0 0" }} data-testid="model-placement">{placement}</p>
        )}
        <p style={{ margin: "0.4rem 0 0" }} data-testid="model-guard">
          {provenance.guard === "passthrough" ? copy.modelGuardOff : copy.modelGuardEitherWay}
        </p>
        {provenance.at && (
          <p className="faint" style={{ margin: "0.4rem 0 0" }} data-testid="model-reported" data-stale={provenance.stale ? "true" : "false"}>
            {provenance.stale
              ? copy.modelStale(provenance.at, humanDuration(provenance.staleness_s ?? 0))
              : copy.modelReported(provenance.at)}
          </p>
        )}
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
