"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Landscape } from "@/components/world/Landscape";
import { Sprite } from "@/components/world/Sprite";
import { habitats, worldCopy as c } from "@/copy/world";
import styles from "./explore.module.css";
import { Chat } from "@/components/Chat";
import { Meters } from "@/components/Meters";
import { PulseLog } from "@/components/PulseLog";
import { Strategy, type StrategyView } from "@/components/Strategy";
import type { HealthSnapshot } from "@kami/needs";
import type { PulseEntry } from "@/lib/status";

export type PublicBeing = {
  slug: string;
  name: string;
  archetype: string;
  paused: boolean;
  snapshot: HealthSnapshot | null;
  pulses: PulseEntry[];
  strategy: StrategyView;
};
type Visit = {
  id: string;
  name: string;
  kind: string;
  note: string;
  description: string;
  x?: number;
  y?: number;
  slug?: string;
  paused?: boolean;
  status?: string;
};
export function WorldExplorer({ entities }: { entities: PublicBeing[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof c.tabs)[number]>("Visit");
  const [filter, setFilter] = useState("All beings");
  const [zoom, setZoom] = useState(1);
  const [guide, setGuide] = useState(false);
  const [answer, setAnswer] = useState<keyof typeof c.guideAnswers>("purpose");
  const dialog = useRef<HTMLDialogElement>(null);
  const beings: Visit[] = useMemo(
    () => [
      ...entities.map((e, i) => ({
        id: e.slug,
        slug: e.slug,
        name: e.name,
        kind: e.archetype,
        paused: e.paused,
        status: e.snapshot?.mood ?? "asleep",
        note: e.paused ? "Paused by guardians" : "Public being",
        description:
          "An AI voice for this place, with observations, a public strategy, and human guardians.",
        x: 0.55 + (i % 3) * 0.14,
        y: 0.8 + Math.floor(i / 3) * 0.1,
      })),
      ...habitats
        .filter((h) => !entities.some((e) => e.name === h.name))
        .map((h) => ({ ...h, status: "awake" })),
    ],
    [entities],
  );
  const visible = beings.filter(
    (b) =>
      filter === "All beings" ||
      (filter === "Water"
        ? ["creek", "reservoir", "watershed"].includes(b.kind)
        : filter === "Forests"
          ? b.kind === "forest"
          : filter === "Wildlife"
            ? b.kind === "elk"
            : b.kind === "mountain"),
  );
  const being = beings.find((b) => b.id === selected);
  const live = entities.find((e) => e.slug === being?.slug);
  useEffect(() => {
    if (being && !dialog.current?.open) dialog.current?.showModal();
    else if (!being) dialog.current?.close();
  }, [being]);
  function visit(id: string) {
    setSelected(id);
    setTab("Visit");
  }
  return (
    <div className={styles.explorer}>
      <div className={styles.landscape}>
        <Landscape
          beings={visible}
          selected={selected}
          onSelect={visit}
          zoom={zoom}
        />
      </div>
      <div className={styles.topline}>
        <span className={styles.regionMark}>⌁</span>
        <div>
          <strong>{c.region}</strong>
          <span>{c.regionDetail}</span>
        </div>
        <span className={styles.previewPill}>An emerging world</span>
      </div>
      <section className={styles.intro}>
        <h1>{c.title}</h1>
        <p>{c.intro}</p>
        <Link href="/summon" className={styles.summon}>
          ✧ Summon a being
        </Link>
        <button className={styles.textButton} onClick={() => setGuide(!guide)}>
          Meet Kami <span>↗</span>
        </button>
      </section>
      <div className={styles.filters} aria-label="Explore habitats">
        {["All beings", "Water", "Forests", "Wildlife", "Mountains"].map(
          (f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ),
        )}
      </div>
      <div className={styles.zoom}>
        <button
          aria-label="Zoom in"
          disabled={zoom >= 1.8}
          onClick={() => setZoom((z) => Math.min(1.8, z + 0.2))}
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          disabled={zoom <= 0.8}
          onClick={() => setZoom((z) => Math.max(0.8, z - 0.2))}
        >
          −
        </button>
        <button
          aria-label="Reset view"
          onClick={() => {
            setZoom(1);
            setFilter("All beings");
          }}
        >
          ⌖
        </button>
      </div>
      <section className={styles.dock} aria-label="Beings and habitat previews">
        <div className={styles.dockTitle}>
          <span>Find a little connection</span>
          <small>Choose a being to visit</small>
        </div>
        <div className={styles.beingList}>
          {visible.map((b) => (
            <button
              key={b.id}
              className={styles.beingCard}
              onClick={() => visit(b.id)}
            >
              <Sprite kind={b.kind} mood={b.status ?? "asleep"} />
              <span>
                <strong>{b.name}</strong>
                <small>{b.note}</small>
              </span>
              <span className={styles.cardArrow}>↗</span>
            </button>
          ))}
        </div>
      </section>
      <p className={styles.mapNote}>{c.illustration}</p>
      {guide && (
        <aside className={styles.guide} aria-label="Kami guide">
          <button
            className={styles.close}
            aria-label="Close Kami guide"
            onClick={() => setGuide(false)}
          >
            ×
          </button>
          <Sprite kind="forest" mood="content" />
          <h2>{c.welcome}</h2>
          <p>{c.welcomeBody}</p>
          <div className={styles.guideChoices}>
            {(["purpose", "care", "honesty"] as const).map((key, i) => (
              <button
                key={key}
                aria-pressed={answer === key}
                onClick={() => setAnswer(key)}
              >
                {
                  ["What are beings?", "How can I help?", "What is real here?"][
                    i
                  ]
                }
              </button>
            ))}
          </div>
          <p className={styles.guideAnswer} aria-live="polite">
            {c.guideAnswers[answer]}
          </p>
          <small>Interactive guide · written introduction</small>
        </aside>
      )}
      <dialog
        ref={dialog}
        aria-label={being ? `Visit ${being.name}` : "Visit a being"}
        className={styles.dialog}
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        {being && (
          <div className={styles.visit}>
            <div className={styles.habitat}>
              <Landscape
                beings={[being]}
                selected={being.id}
                onSelect={() => {}}
                habitat
              />
              <div className={styles.habitatLabel}>
                <span>{being.slug ? "A digital home" : c.preview}</span>
                <h2>{being.name}</h2>
                <p>{being.note}</p>
              </div>
            </div>
            <button
              autoFocus
              className={styles.close}
              aria-label="Return to landscape"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <section className={styles.panel}>
              <p className={styles.entityDisclosure}>
                {being.slug
                  ? `An AI voice for ${being.name}. Software, not the place or a legal person.`
                  : "An illustrated digital being · not connected to sensors"}
              </p>
              <nav className={styles.tabs} aria-label="Habitat sections">
                {c.tabs.map((t) => (
                  <button
                    key={t}
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </nav>
              {tab === "Visit" && (
                <>
                  <h3>
                    A small presence.
                    <br />A place to care for.
                  </h3>
                  <p>{being.description}</p>
                  {being.slug ? (
                    <>
                      <p>
                        {being.paused
                          ? "This being is paused by its guardians."
                          : "Visit its observatory to see its latest available readings and connection state."}
                      </p>
                      {live && (
                        <Chat
                          key={live.slug}
                          slug={live.slug}
                          name={live.name}
                          archetype={live.archetype}
                          paused={live.paused}
                          gpuOnline={live.snapshot?.gpu_online ?? false}
                          compact
                        />
                      )}
                      <Link className={styles.summon} href={`/e/${being.slug}`}>
                        Open observatory ↗
                      </Link>
                      <Link
                        className={styles.secondary}
                        href={`/e/${being.slug}/chat`}
                      >
                        Open chat
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className={styles.notice}>{c.previewBody}</p>
                      <Link className={styles.summon} href="/summon">
                        Summon a being like this ✧
                      </Link>
                    </>
                  )}
                </>
              )}
              {tab === "Senses" && (
                <>
                  <h3>
                    Listening to
                    <br />a living place.
                  </h3>
                  <p>{c.signalBody}</p>
                  {live ? (
                    <Meters snapshot={live.snapshot} />
                  ) : (
                    <div className={styles.readings}>
                      {[
                        "Water & flow",
                        "Habitat & biodiversity",
                        "Weather & snow",
                      ].map((label) => (
                        <div key={label}>
                          <span>{label}</span>
                          <strong>—</strong>
                          <small>
                            {being.slug
                              ? "View source readings in observatory"
                              : "Awaiting a connection"}
                          </small>
                        </div>
                      ))}
                    </div>
                  )}
                  {being.slug && (
                    <Link
                      className={styles.secondary}
                      href={`/e/${being.slug}`}
                    >
                      See measured conditions ↗
                    </Link>
                  )}
                </>
              )}
              {tab === "Stewardship" && (
                <>
                  <h3>
                    Care that leaves
                    <br />a public trail.
                  </h3>
                  <p>{c.strategyBody}</p>
                  {live && (
                    <>
                      <Strategy strategy={live.strategy} />
                      <PulseLog pulses={live.pulses} />
                    </>
                  )}
                  <ol className={styles.learning}>
                    <li>Observe the available evidence</li>
                    <li>Publish a strategy and invite proposals</li>
                    <li>Fund human work with guardian approval</li>
                    <li>Verify outcomes and share what was learned</li>
                  </ol>
                  <p className={styles.notice}>{c.coalition}</p>
                  {being.slug && (
                    <Link
                      className={styles.secondary}
                      href={`/e/${being.slug}/proposals`}
                    >
                      Open the project board ↗
                    </Link>
                  )}
                </>
              )}
              <div className={styles.promise}>
                <strong>{c.ethics}</strong>
                <p>{c.ethicsBody}</p>
              </div>
            </section>
          </div>
        )}
      </dialog>
    </div>
  );
}
