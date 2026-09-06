"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RiveAvatar } from "@/components/avatar/RiveAvatar";
import { moodLabel, seasonLabel } from "@/copy";
import { RIG_CHECKLIST, checklistStorageKey } from "@/lib/avatar/checklist";
import {
  MOOD_NAMES,
  fallbackSrc,
  riveInputsToViewModel,
  snapshotToRiveInputs,
  type HealthSnapshot,
  type RiveInputs,
} from "@/lib/avatar/inputs";
import { ARCHETYPES, MOODS, STATE_MACHINE, VIEW_MODEL, rigFor, type Archetype } from "@/lib/avatar/rigs";
import fixture from "@/fixtures/status/boulder-creek.json";

/** The cosmetic slots the brief asks for (rive/INPUT-CONTRACT.md §3). */
const COSMETIC_SLOTS = ["cosmetic_hat", "cosmetic_scarf", "cosmetic_badge", "cosmetic_garland"] as const;

function defaultInputs(): RiveInputs {
  return {
    flow_pct: 55,
    snow_pct: -1,
    air_pct: 30,
    temp_pct: -1,
    alert_level: 0,
    drought: 0,
    mood: 1,
    stale: false,
    paused: false,
    gpu_online: true,
    season: 2,
    headline_label: "15.4 cfs at Orodell, 2026-09-06 05:00Z",
    cosmetic_hat: 0,
    cosmetic_scarf: 0,
    cosmetic_badge: 0,
    cosmetic_garland: 0,
  };
}

type Binding = { applied: string[]; missing: string[] } | null;

export function RigBench({ archetype }: { archetype: Archetype }) {
  const rig = rigFor(archetype);
  const [inputs, setInputs] = useState<RiveInputs>(defaultInputs);
  const [forceReduced, setForceReduced] = useState(false);
  const [greyscale, setGreyscale] = useState(false);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const [binding, setBinding] = useState<Binding>(null);

  const key = checklistStorageKey(archetype);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setTicks(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* no storage */
    }
  }, [key]);

  const tick = (id: string, on: boolean) => {
    const next = { ...ticks, [id]: on };
    setTicks(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* no storage */
    }
  };
  const resetTicks = () => {
    setTicks({});
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* no storage */
    }
  };

  const set = <K extends keyof RiveInputs>(k: K, v: RiveInputs[K]) => setInputs((s) => ({ ...s, [k]: v }));
  const setNum = (k: string, v: number) => setInputs((s) => ({ ...s, [k]: v }) as RiveInputs);

  const viewModel = useMemo(() => riveInputsToViewModel(inputs), [inputs]);
  const json = useMemo(() => JSON.stringify(inputs, null, 2), [inputs]);
  const done = RIG_CHECKLIST.filter((c) => ticks[c.id]).length;
  const mood = MOOD_NAMES[inputs.mood] ?? "asleep";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(""), 1500);
  };

  const loadFixture = () => setInputs({ ...defaultInputs(), ...snapshotToRiveInputs(fixture.snapshot as HealthSnapshot) });

  return (
    <div className="stack" style={{ paddingTop: "1rem" }}>
      <p className="eyebrow">dev · T1.8 acceptance · {archetype}</p>
      <h1 style={{ margin: 0 }}>Rig bench — {archetype}</h1>
      <p className="muted" style={{ margin: 0 }}>
        Rig <code>{rig.src}</code>: {rig.available ? "available" : "not available — the SVG fallback is authoritative"}. State machine <code>{STATE_MACHINE}</code>,
        ViewModel <code>{VIEW_MODEL}</code>. Mood is driven here by hand; in production only <code>@kami/needs</code> sets it.
      </p>
      <nav aria-label="Archetypes" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {ARCHETYPES.map((a) => (
          <Link key={a} href={`/dev/rig/${a}`} className="chip" aria-current={a === archetype ? "page" : undefined} style={a === archetype ? { borderColor: "var(--accent)" } : undefined}>
            {a}
          </Link>
        ))}
      </nav>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", gap: "1rem" }}>
        <section className="card" aria-labelledby="stage-h">
          <h2 id="stage-h" style={{ marginTop: 0 }}>Stage</h2>
          <div style={{ display: "flex", justifyContent: "center", filter: greyscale ? "grayscale(1)" : undefined }}>
            <RiveAvatar key={`${archetype}-${forceReduced}`} archetype={archetype} inputs={inputs} label={`${archetype} bench: ${mood}`} reducedMotion={forceReduced} size={280} onBinding={setBinding} />
          </div>
          <p className="muted" style={{ textAlign: "center" }}>
            mood <strong>{moodLabel[mood]}</strong> · season {seasonLabel[inputs.season]} · {inputs.stale ? "stale" : "live"}
          </p>
          <label className="check">
            <input type="checkbox" checked={forceReduced} onChange={(e) => setForceReduced(e.target.checked)} /> force reduced motion (rest pose, runtime not started)
          </label>
          <label className="check">
            <input type="checkbox" checked={greyscale} onChange={(e) => setGreyscale(e.target.checked)} /> greyscale (colour must not carry meaning alone)
          </label>
          {binding ? (
            <p className="faint" style={{ fontSize: "0.85rem" }}>
              bound {binding.applied.length} properties{binding.missing.length ? `; missing in rig: ${binding.missing.join(", ")}` : ""}
            </p>
          ) : null}
          <h3 style={{ fontSize: "1rem" }}>All five poses (stale must not look like distressed)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.25rem", filter: greyscale ? "grayscale(1)" : undefined }}>
            {MOODS.map((m) => (
              <figure key={m} style={{ margin: 0, textAlign: "center" }}>
                <img src={fallbackSrc(archetype, m)} alt={`${archetype} ${m}`} width={240} height={240} style={{ width: "100%", height: "auto" }} />
                <figcaption className="faint" style={{ fontSize: "0.75rem" }}>{m}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="card stack" aria-labelledby="inputs-h">
          <h2 id="inputs-h" style={{ marginTop: 0 }}>Inputs (§9.2)</h2>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => setInputs(defaultInputs())}>defaults</button>
            <button type="button" className="btn" onClick={loadFixture}>Boulder Creek fixture (stale → asleep)</button>
          </div>
          {(["flow_pct", "snow_pct", "air_pct", "temp_pct"] as const).map((k) => (
            <label key={k} style={{ display: "block" }}>
              <code>{k}</code> = {inputs[k] < 0 ? "−1 (absent)" : inputs[k]}
              <input type="range" min={-1} max={100} step={1} value={inputs[k]} onChange={(e) => set(k, Number(e.target.value))} style={{ width: "100%" }} />
            </label>
          ))}
          <label style={{ display: "block" }}>
            <code>alert_level</code> = {inputs.alert_level}
            <input type="range" min={0} max={3} step={1} value={inputs.alert_level} onChange={(e) => set("alert_level", Number(e.target.value) as RiveInputs["alert_level"])} style={{ width: "100%" }} />
          </label>
          <label style={{ display: "block" }}>
            <code>drought</code> = {inputs.drought < 0 ? "−1 (unknown)" : `D${inputs.drought}`}
            <input type="range" min={-1} max={4} step={1} value={inputs.drought} onChange={(e) => set("drought", Number(e.target.value) as RiveInputs["drought"])} style={{ width: "100%" }} />
          </label>
          <label style={{ display: "block" }}>
            <code>mood</code>{" "}
            <select className="field" value={inputs.mood} onChange={(e) => set("mood", Number(e.target.value) as RiveInputs["mood"])}>
              {MOOD_NAMES.map((m, i) => (
                <option key={m} value={i}>{i} — {m}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "block" }}>
            <code>season</code>{" "}
            <select className="field" value={inputs.season} onChange={(e) => set("season", Number(e.target.value) as RiveInputs["season"])}>
              {[0, 1, 2, 3].map((s) => (
                <option key={s} value={s}>{s} — {seasonLabel[s]}</option>
              ))}
            </select>
          </label>
          {(["stale", "paused", "gpu_online"] as const).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={inputs[k]} onChange={(e) => set(k, e.target.checked)} /> <code>{k}</code>
            </label>
          ))}
          <label style={{ display: "block" }}>
            <code>headline_label</code>
            <input className="field" type="text" value={inputs.headline_label} onChange={(e) => set("headline_label", e.target.value)} />
          </label>
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>
            <legend>cosmetic_* slots (0 = none)</legend>
            {COSMETIC_SLOTS.map((k) => (
              <label key={k} style={{ display: "flex", gap: "0.5rem", alignItems: "center", minHeight: "var(--tap)" }}>
                <code style={{ flex: 1 }}>{k}</code>
                <input type="number" min={0} max={9} step={1} value={(inputs as Record<string, number | boolean | string>)[k] as number} onChange={(e) => setNum(k, Number(e.target.value))} style={{ width: "5rem" }} className="field" />
              </label>
            ))}
          </fieldset>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button type="button" className="btn btn-primary" onClick={copy}>copy inputs JSON</button>
            <span className="faint" aria-live="polite">{copied === "ok" ? "copied" : copied === "fail" ? "clipboard blocked — select the JSON below" : ""}</span>
          </div>
          <details>
            <summary>inputs JSON</summary>
            <pre className="sunken" style={{ overflowX: "auto", fontSize: "0.8rem" }}>{json}</pre>
          </details>
          <details>
            <summary>ViewModel values (what the rig receives)</summary>
            <pre className="sunken" style={{ overflowX: "auto", fontSize: "0.8rem" }}>{JSON.stringify(viewModel, null, 2)}</pre>
          </details>
        </section>
      </div>

      <section className="card" aria-labelledby="check-h">
        <h2 id="check-h" style={{ marginTop: 0 }}>
          Acceptance checklist <span className="faint" style={{ fontWeight: 400 }}>({done}/{RIG_CHECKLIST.length}, saved in this browser)</span>
        </h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {RIG_CHECKLIST.map((c) => (
            <li key={c.id}>
              <label className="check">
                <input type="checkbox" checked={ticks[c.id] === true} onChange={(e) => tick(c.id, e.target.checked)} />
                <span>{c.text}</span>
              </label>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={resetTicks} style={{ marginTop: "0.5rem" }}>reset checklist</button>
      </section>
    </div>
  );
}
