import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connect as connectCopy, landing } from "@/copy";
import { getDb } from "@/db/client";
import { getSession } from "@/lib/session";
import { EntitySoFar } from "@/components/summon/EntitySoFar";
import { HardRules } from "@/components/summon/HardRules";
import { PlaceSearch } from "@/components/summon/PlaceSearch";
import { PreviewChat } from "@/components/summon/PreviewChat";
import { Progress } from "@/components/summon/Progress";
import { SensingTable } from "@/components/summon/SensingTable";
import { SiblingsFirst } from "@/components/summon/SiblingsFirst";
import { SummonMessage, firstParam } from "@/components/summon/SummonMessage";
import { summon } from "@/lib/summon/copy";
import { isSummonError, loadDraft, publishState, resumeStep, stepIsComplete, type Draft, DONE_STEP } from "@/lib/summon/draft";
import { ARCHETYPE_OPTIONS, COLOURS, PART_SLOTS } from "@/lib/summon/parts";
import { siblingsForAnchor } from "@/lib/summon/siblings";
import { loadHardRules } from "@/lib/summon/soul";
import { safeReadiness } from "@/lib/summon/safe";
import {
  choosePlaceAction,
  completeSummonAction,
  markConsultationDoneAction,
  saveConsultationAction,
  saveFundAction,
  saveGuardiansAction,
  savePartsAction,
  saveSoulAction,
} from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: summon.title, robots: { index: false } };

type Props = {
  params: Promise<{ id: string; step: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STEP_NUMBERS = ["1", "2", "3", "4", "5"];

function Nav({ draft, step }: { draft: Draft; step: number }) {
  if (step <= 1) return null;
  return (
    <p style={{ marginTop: "1rem" }}>
      <Link className="btn" href={`/summon/${draft.id}/${step - 1}`}>{summon.back}</Link>
    </p>
  );
}

export default async function SummonStep({ params, searchParams }: Props) {
  const { id, step: stepParam } = await params;
  const sp = await searchParams;
  const ok = firstParam(sp, "ok");
  const error = firstParam(sp, "error");

  const session = await getSession();
  if (!session) {
    return (
      <p className="sunken">
        {summon.notSignedIn} <Link href="/sign-in" className="btn btn-primary">{landing.signIn}</Link>
      </p>
    );
  }
  const db = getDb();
  if (!db) return <p className="sunken">{summon.noDb}</p>;

  let draft: Draft;
  try {
    draft = await loadDraft(id, session.user.id, { db });
  } catch (err) {
    if (isSummonError(err)) notFound();
    throw err;
  }

  const reached = Math.min(resumeStep(draft.data), 6);
  const isReview = stepParam === "review";
  const isDone = stepParam === "done";
  if (!isReview && !isDone && !STEP_NUMBERS.includes(stepParam)) notFound();
  if (draft.data.completed && !isDone) redirect(`/summon/${id}/done`);
  const step = isReview ? 6 : isDone ? 7 : Number(stepParam);

  const header = (
    <>
      <Progress draftId={id} current={isDone ? "done" : isReview ? "review" : step} reached={reached} />
      <SummonMessage ok={ok} error={error} />
    </>
  );

  // -------------------------------------------------------------------------
  // step 1 — place
  // -------------------------------------------------------------------------
  if (step === 1) {
    const place = draft.data.place;
    const siblings = place ? await siblingsForAnchor(place.binding.anchor, null, db) : [];
    return (
      <>
        {header}
        <h1>{summon.place.title}</h1>
        <p className="muted">{summon.place.intro}</p>

        <PlaceSearch draftId={id} chosenId={place?.picked_id ?? null} action={choosePlaceAction} />

        {place ? (
          <>
            <SiblingsFirst siblings={siblings} placeName={place.picked_name} />
            <div className="card stack" role="status">
              <strong>{summon.place.selected(place.name)}</strong>
              <p style={{ margin: 0 }}>{summon.place.selectedHelp}</p>
              <Link className="btn btn-primary" href={`/summon/${id}/2`}>
                {summon.place.continueAppearance}
              </Link>
            </div>

            <section className="section" aria-labelledby="proposal-h">
              <h2 id="proposal-h">{summon.place.proposalHeading}</h2>
              <p className="sunken" style={{ marginTop: 0 }}>{summon.place.provenance}</p>
              <dl style={{ margin: 0 }}>
                <dt className="eyebrow">{summon.place.anchor}</dt>
                <dd style={{ margin: "0 0 0.5rem", wordBreak: "break-all" }}><code>{place.binding.anchor}</code></dd>
                <dt className="eyebrow">{summon.place.membersHeading(place.binding.members.length)}</dt>
                <dd style={{ margin: "0 0 0.5rem" }}>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
                    {place.binding.members.map((m) => (
                      <li key={m.id}>
                        {m.name ?? m.id} <span className="faint">({m.role})</span>
                      </li>
                    ))}
                  </ul>
                </dd>
                <dt className="eyebrow">{summon.place.watershedsHeading(place.binding.watersheds.length)}</dt>
                <dd style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>{place.binding.watersheds.join(", ") || "—"}</dd>
              </dl>
              {place.notes.length > 0 ? (
                <ul className="muted" style={{ paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
                  {place.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              ) : null}
              {!place.validation.ok ? (
                <div className="card" style={{ borderColor: "var(--danger)" }}>
                  <p style={{ margin: 0, color: "var(--danger)" }}>{summon.place.validationErrors}</p>
                  <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
                    {place.validation.errors.map((e) => <li key={`${e.path}${e.message}`}><code>{e.path}</code> {e.message}</li>)}
                  </ul>
                </div>
              ) : null}
              {place.validation.warnings.length > 0 ? (
                <details>
                  <summary className="tap" style={{ cursor: "pointer" }}>{summon.place.validationWarnings}</summary>
                  <ul style={{ paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
                    {place.validation.warnings.map((w) => <li key={`${w.path}${w.message}`}><code>{w.path}</code> {w.message}</li>)}
                  </ul>
                </details>
              ) : null}
            </section>

            <SensingTable rows={place.sensing} gaps={place.gaps} />

            <form action={choosePlaceAction} className="card stack">
              <input type="hidden" name="draft_id" value={id} />
              <input type="hidden" name="place_id" value={place.picked_id} />
              <label>
                <span className="eyebrow">{summon.place.nameLabel}</span>
                <input className="field" name="name" defaultValue={place.name} required maxLength={120} />
                <span className="faint" style={{ fontSize: "0.8rem" }}>{summon.place.nameHelp}</span>
              </label>
              <label>
                <span className="eyebrow">{summon.place.slugLabel}</span>
                <input className="field" name="slug" defaultValue={place.slug} pattern="[a-z0-9-]{1,64}" required />
              </label>
              <label>
                <span className="eyebrow">{summon.place.archetypeLabel}</span>
                <select className="field" name="archetype" defaultValue={place.archetype}>
                  {ARCHETYPE_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </label>
              <details>
                <summary className="tap" style={{ cursor: "pointer" }}>Membership rule</summary>
                <div className="stack" style={{ marginTop: "0.5rem" }}>
                  <label>
                    <span className="eyebrow">Name contains</span>
                    <input className="field" name="query" defaultValue={place.query} />
                  </label>
                  <label>
                    <span className="eyebrow">{summon.place.gnisLabel}</span>
                    <input className="field" name="gnis_id" defaultValue={place.gnis_id ?? ""} />
                    <span className="faint" style={{ fontSize: "0.8rem" }}>{summon.place.gnisHelp}</span>
                  </label>
                  <p className="faint" style={{ margin: 0, fontSize: "0.85rem" }}><code>{place.binding.membership_rule}</code></p>
                </div>
              </details>
              <button className="btn" type="submit">Re-propose with these</button>
            </form>

            <p style={{ marginTop: "1rem" }}>
              <Link className="btn btn-primary" href={`/summon/${id}/2`}>
                {siblings.length > 0 ? summon.siblings.continueAnyway : summon.next}
              </Link>
            </p>
          </>
        ) : null}
        <EntitySoFar data={draft.data} />
      </>
    );
  }

  // -------------------------------------------------------------------------
  // step 2 — archetype and parts
  // -------------------------------------------------------------------------
  if (step === 2) {
    const current = draft.data.parts?.rive_config;
    const archetype = current?.archetype ?? draft.data.place?.archetype ?? "creek";
    return (
      <>
        {header}
        <h1>{summon.parts.title}</h1>
        <p className="sunken">{summon.parts.intro}</p>
        <p className="muted">{summon.parts.rigPending}</p>
        <form action={savePartsAction} className="stack">
          <input type="hidden" name="draft_id" value={id} />
          <label>
            <span className="eyebrow">{summon.parts.archetype}</span>
            <select className="field" name="archetype" defaultValue={archetype}>
              {ARCHETYPE_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "0.75rem" }}>
            <legend className="eyebrow">{summon.parts.colour}</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {COLOURS.map((c) => (
                <label key={c.id} className="check" style={{ minWidth: "9rem" }}>
                  <input type="radio" name="colour" value={c.id} defaultChecked={(current?.colour ?? COLOURS[0]!.id) === c.id} />
                  <span>
                    <span aria-hidden="true" style={{ display: "inline-block", width: "0.9rem", height: "0.9rem", background: c.hex, borderRadius: 3, marginRight: "0.4rem", border: "1px solid var(--line)" }} />
                    {c.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "0.75rem" }}>
            <legend className="eyebrow">{summon.parts.parts}</legend>
            <div className="stack">
              {PART_SLOTS.map((slot) => (
                <label key={slot.key}>
                  <span className="eyebrow">{slot.label}</span>
                  <select className="field" name={`part_${slot.key}`} defaultValue={current?.parts[slot.key] ?? slot.options[0]!.id}>
                    {slot.options.map((o) => (
                      <option key={o.id} value={o.id} disabled={Boolean(o.earned_by)}>
                        {o.label}
                        {o.earned_by ? ` — ${summon.parts.locked}` : ""}
                      </option>
                    ))}
                  </select>
                  {slot.options.some((o) => o.earned_by) ? (
                    <span className="faint" style={{ fontSize: "0.8rem" }}>
                      {slot.options.filter((o) => o.earned_by).map((o) => `${o.label}: ${o.earned_by}`).join(" · ")}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="btn btn-primary" type="submit">{summon.next}</button>
        </form>
        <Nav draft={draft} step={step} />
        <EntitySoFar data={draft.data} />
      </>
    );
  }

  // -------------------------------------------------------------------------
  // step 3 — soul
  // -------------------------------------------------------------------------
  if (step === 3) {
    const rules = await loadHardRules();
    const voice = draft.data.soul?.voice_md ?? "";
    const place = draft.data.place;
    return (
      <>
        {header}
        <h1>{summon.soul.title}</h1>
        <HardRules block={rules.block} version={rules.version} />

        <section className="section" aria-labelledby="voice-h">
          <h3 id="voice-h" style={{ fontSize: "1rem" }}>{summon.soul.voiceHeading}</h3>
          <p className="muted" style={{ marginTop: 0 }}>{summon.soul.voiceIntro}</p>
          <form action={saveSoulAction} className="stack">
            <input type="hidden" name="draft_id" value={id} />
            <label>
              <span className="eyebrow">{summon.soul.voiceLabel}</span>
              <textarea className="field" name="voice" required maxLength={1200} defaultValue={voice} style={{ minHeight: "9rem", paddingBlock: "0.6rem" }} />
            </label>
            <button className="btn btn-primary" type="submit">{summon.next}</button>
          </form>
        </section>

        <section className="section" aria-labelledby="examples-h">
          <h3 id="examples-h" style={{ fontSize: "1rem" }}>{summon.soul.examplesHeading}</h3>
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {summon.soul.examples.map((ex) => (
              <li key={ex.label} className="sunken">
                <p className="eyebrow" style={{ margin: 0 }}>{ex.label}</p>
                <p style={{ margin: "0.25rem 0 0" }}>{ex.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {place ? (
          <PreviewChat slug={place.slug} name={place.name} voice={voice} archetype={place.archetype} />
        ) : (
          <p className="sunken">{summon.soul.previewNoSoul}</p>
        )}
        <Nav draft={draft} step={step} />
        <EntitySoFar data={draft.data} />
      </>
    );
  }

  // -------------------------------------------------------------------------
  // step 4 — guardians
  // -------------------------------------------------------------------------
  if (step === 4) {
    const emails = draft.data.guardians?.emails ?? ["", ""];
    return (
      <>
        {header}
        <h1>{summon.guardians.title}</h1>
        <p className="muted">{summon.guardians.intro}</p>
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
          {summon.guardians.roles.map((r) => (
            <li key={r.name} className="sunken">
              <strong>{r.name}</strong> — {r.one}
            </li>
          ))}
        </ul>
        <form action={saveGuardiansAction} className="stack">
          <input type="hidden" name="draft_id" value={id} />
          {[1, 2].map((n) => (
            <label key={n}>
              <span className="eyebrow">{summon.guardians.emailLabel(n)}</span>
              <input className="field" type="email" name={`guardian_${n}`} required defaultValue={emails[n - 1] ?? ""} autoComplete="off" inputMode="email" />
            </label>
          ))}
          <p className="faint" style={{ margin: 0, fontSize: "0.85rem" }}>{summon.guardians.emailHelp}</p>
          <p className="sunken" style={{ margin: 0 }}>{summon.guardians.liveOn}</p>
          <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>{summon.guardians.safeConfigured}</p>
          <button className="btn btn-primary" type="submit">{summon.next}</button>
        </form>
        <Nav draft={draft} step={step} />
        <EntitySoFar data={draft.data} />
      </>
    );
  }

  // -------------------------------------------------------------------------
  // step 5 — fund
  // -------------------------------------------------------------------------
  if (step === 5) {
    const slug = draft.data.place?.slug;
    return (
      <>
        {header}
        <h1>{summon.fund.title}</h1>
        <p className="muted">{summon.fund.intro}</p>
        <div className="card">
          <p className="eyebrow" style={{ margin: 0 }}>{summon.fund.cannot}</p>
          <ul style={{ margin: "0.35rem 0 0.75rem", paddingLeft: "1.2rem" }}>
            {summon.fund.cannotList.map((l) => <li key={l}>{l}</li>)}
          </ul>
          <p className="eyebrow" style={{ margin: 0 }}>{summon.fund.can}</p>
          <ul style={{ margin: "0.35rem 0 0.75rem", paddingLeft: "1.2rem" }}>
            {summon.fund.canList.map((l) => <li key={l}>{l}</li>)}
          </ul>
          <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>{summon.fund.fees}</p>
        </div>
        <form action={saveFundAction} className="stack" style={{ marginTop: "1rem" }}>
          <input type="hidden" name="draft_id" value={id} />
          <label>
            <span className="eyebrow">A note about funding (optional)</span>
            <textarea className="field" name="note" maxLength={500} defaultValue={draft.data.fund?.note ?? ""} style={{ minHeight: "4rem", paddingBlock: "0.5rem" }} />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit">{summon.next}</button>
            <button className="btn" type="submit" name="skip" value="1">{summon.fund.skip}</button>
          </div>
        </form>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          {slug ? (
            <>
              {summon.fund.donateLater}{" "}
              <Link className="tap" href={`/e/${slug}/donate`} style={{ paddingInline: 0 }}>{summon.fund.donateLink}</Link>
            </>
          ) : (
            summon.fund.donateLater
          )}
        </p>
        <Nav draft={draft} step={step} />
        <EntitySoFar data={draft.data} />
      </>
    );
  }

  // -------------------------------------------------------------------------
  // review
  // -------------------------------------------------------------------------
  if (isReview) {
    const missing = [1, 2, 3, 4].find((n) => !stepIsComplete(draft.data, n));
    const place = draft.data.place;
    return (
      <>
        {header}
        <h1>{summon.review.title}</h1>
        <p className="muted">{summon.review.intro}</p>
        <EntitySoFar data={draft.data} />

        {place ? <SensingTable rows={place.sensing} gaps={place.gaps} /> : null}
        <p className="sunken">{summon.review.bindingPending}</p>

        <section className="section" aria-labelledby="consult-h">
          <h2 id="consult-h">{summon.review.consultationHeading}</h2>
          <p className="muted">{summon.review.consultationIntro}</p>
          <form action={saveConsultationAction} className="stack">
            <input type="hidden" name="draft_id" value={id} />
            <label>
              <span className="eyebrow">{summon.review.consultationLabel}</span>
              <textarea className="field" name="consultation" maxLength={4000} defaultValue={draft.data.consultation?.md ?? ""} style={{ minHeight: "7rem", paddingBlock: "0.6rem" }} />
              <span className="faint" style={{ fontSize: "0.8rem" }}>{summon.review.consultationHelp}</span>
            </label>
            <button className="btn" type="submit">Save the record</button>
          </form>
          <p className="sunken" style={{ marginTop: "0.75rem" }}>{summon.review.consultationPending}</p>
        </section>

        {missing ? (
          <p className="card" style={{ borderColor: "var(--danger)" }}>{summon.review.incomplete(missing)}</p>
        ) : (
          <form action={completeSummonAction} style={{ marginTop: "1rem" }}>
            <input type="hidden" name="draft_id" value={id} />
            <button className="btn btn-primary" type="submit">{summon.review.confirm}</button>
          </form>
        )}
        <Nav draft={draft} step={5} />
      </>
    );
  }

  // -------------------------------------------------------------------------
  // done
  // -------------------------------------------------------------------------
  const completed = draft.data.completed;
  if (!completed) redirect(`/summon/${id}/${Math.min(resumeStep(draft.data), 6) === 6 ? "review" : resumeStep(draft.data)}`);
  const state = await publishState(db, completed.entity_id);
  const safe = await safeReadiness(db, completed.entity_id);
  return (
    <>
      <Progress draftId={id} current="done" reached={DONE_STEP} />
      <SummonMessage ok={ok} error={error} />
      <h1>{summon.review.created}</h1>
      <p>{summon.review.createdBody(draft.data.place?.name ?? completed.slug)}</p>
      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        <li className="sunken">{summon.review.bindingPending}</li>
        <li className="sunken">
          {state.published ? summon.review.consultationDone(state.consultation_done_at!) : summon.review.consultationPending}
        </li>
        <li className="sunken">{safe.state === "deployed" ? safe.reason : `${summon.guardians.safePending} ${safe.reason}`}</li>
        <li className="sunken">
          {summon.guardians.liveOn}
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.2rem" }}>
            {(draft.data.guardians?.emails ?? []).map((e) => <li key={e}>{summon.guardians.pending(e)}</li>)}
          </ul>
        </li>
      </ul>
      <p className="sunken">{connectCopy.nextStepHint}</p>
      <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Link className="btn btn-primary" href={`/e/${completed.slug}/connect`}>{connectCopy.nextStep}</Link>
        <Link className="btn" href={`/e/${completed.slug}`}>{summon.review.goToEntity}</Link>
        <Link className="btn" href={`/e/${completed.slug}/donate`}>{summon.fund.donateLink}</Link>
      </p>
      {session.user.platform_admin && !state.published ? (
        <form action={markConsultationDoneAction} className="card">
          <input type="hidden" name="draft_id" value={id} />
          <input type="hidden" name="entity_id" value={completed.entity_id} />
          <p className="muted" style={{ marginTop: 0 }}>{state.consultation_md ?? "No consultation record was written."}</p>
          <button className="btn" type="submit">{summon.review.markDone}</button>
        </form>
      ) : null}
    </>
  );
}
