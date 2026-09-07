import type { Metadata } from "next";
import Link from "next/link";
import { landing } from "@/copy";
import { KamiGuide } from "./KamiGuide";
import { experience } from "./experience-copy";
import styles from "./summon.module.css";
import { summon } from "@/lib/summon/copy";
import { listDrafts, resumeStep, DONE_STEP } from "@/lib/summon/draft";
import { getDb } from "@/db/client";
import { getSession } from "@/lib/session";
import { deleteDraftAction, startSummonAction } from "./actions";
import { SummonMessage, firstParam } from "@/components/summon/SummonMessage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Summon a being", description: experience.intro, robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SummonHome({ searchParams }: Props) {
  const params = await searchParams;
  const session = await getSession();
  const db = getDb();
  const drafts = session && db ? await listDrafts(session.user.id, { db }) : [];

  return (
    <>
      <SummonMessage ok={firstParam(params, "ok")} error={firstParam(params, "error")} />
      <section className={styles.hero}>
        <div className={styles.introduction}>
          <h1>{experience.title}</h1>
          <p>{experience.intro}</p>
          <div className={styles.gate}>
            {!session ? <>
              <p>{experience.signInHelp}</p>
              <Link href="/sign-in" className="btn btn-primary">{landing.signIn}</Link>
            </> : !db ? <p className="sunken">{summon.noDb}</p> : (
              <form action={startSummonAction}>
                <button className="btn btn-primary" type="submit">{experience.start}</button>
              </form>
            )}
          </div>
        </div>
        <KamiGuide />
      </section>
      {session && db ? (
        <>
          {drafts.length > 0 ? (
            <section className={styles.drafts} aria-labelledby="drafts-h">
              <h2 id="drafts-h">{experience.draftsTitle}</h2>
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {drafts.map((d) => {
                  const step = resumeStep(d.data);
                  const done = step === DONE_STEP;
                  const name = d.data.place?.name ?? experience.draftUntitled;
                  return (
                    <li key={d.id} className="sunken">
                      <p style={{ margin: 0, fontWeight: 600 }}>{name}</p>
                      <p className="faint" style={{ margin: "0.15rem 0 0.5rem", fontSize: "0.85rem" }}>
                        {done ? summon.review.created : summon.draftLine(Math.min(step, 5), d.updated_at ?? "—")}
                      </p>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <Link className="btn" href={`/summon/${d.id}/${done ? "done" : step === 6 ? "review" : step}`}>
                          {done ? summon.review.goToEntity : summon.resume}
                        </Link>
                        {!done ? (
                          <form action={deleteDraftAction}>
                            <input type="hidden" name="draft_id" value={d.id} />
                            <button className="btn" type="submit">Discard</button>
                          </form>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

        </>
      ) : null}

      <section className={styles.path}>
        <h2>{experience.stepsTitle}</h2>
        <ol className={styles.steps}>
          {experience.steps.map((step) => <li key={step.title}><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}
        </ol>
      </section>
      <section className={styles.code} aria-labelledby="code-of-care">
        <h2 id="code-of-care">{experience.codeTitle}</h2>
        <p>{experience.codeIntro}</p>
        <ul>{experience.code.map((line) => <li key={line}>{line}</li>)}</ul>
        <p>{summon.review.consultationIntro}</p>
      </section>
      <details className={styles.availability}>
        <summary>{experience.availabilityTitle}</summary>
        <p>{experience.availability}</p>
      </details>
    </>
  );
}
