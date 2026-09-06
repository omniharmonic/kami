import type { Metadata } from "next";
import Link from "next/link";
import { landing } from "@/copy";
import { summon } from "@/lib/summon/copy";
import { listDrafts, resumeStep, DONE_STEP } from "@/lib/summon/draft";
import { getDb } from "@/db/client";
import { getSession } from "@/lib/session";
import { deleteDraftAction, startSummonAction } from "./actions";
import { SummonMessage, firstParam } from "@/components/summon/SummonMessage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: summon.title, description: summon.intro, robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SummonHome({ searchParams }: Props) {
  const params = await searchParams;
  const session = await getSession();
  const db = getDb();
  const drafts = session && db ? await listDrafts(session.user.id, { db }) : [];

  return (
    <>
      <h1>{summon.title}</h1>
      <p className="muted">{summon.intro}</p>
      <SummonMessage ok={firstParam(params, "ok")} error={firstParam(params, "error")} />

      {!session ? (
        <p className="sunken">
          {summon.notSignedIn}{" "}
          <Link href="/sign-in" className="btn btn-primary" style={{ marginLeft: "0.5rem" }}>{landing.signIn}</Link>
        </p>
      ) : !db ? (
        <p className="sunken">{summon.noDb}</p>
      ) : (
        <>
          {drafts.length > 0 ? (
            <section className="section" aria-labelledby="drafts-h">
              <h2 id="drafts-h">{summon.drafts}</h2>
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {drafts.map((d) => {
                  const step = resumeStep(d.data);
                  const done = step === DONE_STEP;
                  const name = d.data.place?.name ?? "Untitled";
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

          <form action={startSummonAction} className="section">
            <button className="btn btn-primary" type="submit">{summon.start}</button>
          </form>
        </>
      )}

      <section className="section">
        <h2>The five steps</h2>
        <ol className="stack" style={{ paddingLeft: "1.2rem" }}>
          <li>{summon.place.title} — {summon.place.intro}</li>
          <li>{summon.parts.title} — {summon.parts.intro}</li>
          <li>{summon.soul.title} — {summon.soul.voiceIntro}</li>
          <li>{summon.guardians.title} — {summon.guardians.intro}</li>
          <li>{summon.fund.title} — {summon.fund.intro}</li>
        </ol>
        <p className="muted">{summon.review.consultationIntro}</p>
      </section>
    </>
  );
}
