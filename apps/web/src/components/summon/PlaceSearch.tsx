"use client";

/**
 * Step 1's search box. Debounced (350 ms), server-side reads only: this
 * component calls `/api/summon/search`, which is the only thing that touches
 * the twin. Works without JavaScript too — the plain submit button posts the
 * same form to the same route.
 */
import { useEffect, useId, useRef, useState } from "react";
import { summon } from "@/lib/summon/copy";
import type { PlaceHit, PlaceSearchResult } from "@/lib/summon/places";

type Props = {
  draftId: string;
  /** the chosen place, when step 1 has already been saved */
  chosenId?: string | null;
  action: (fd: FormData) => void | Promise<void>;
};

export function PlaceSearch({ draftId, chosenId, action }: Props) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [huc, setHuc] = useState("");
  const [result, setResult] = useState<PlaceSearchResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState<PlaceHit[]>([]);
  const abort = useRef<AbortController | null>(null);
  const listId = useId();

  useEffect(() => {
    if (q.trim().length < 2 && !huc) {
      setResult(null);
      setMore([]);
      return;
    }
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setPending(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: q.trim() });
        if (kind) params.set("kind", kind);
        if (huc) params.set("huc", huc);
        const res = await fetch(`/api/summon/search?${params.toString()}`, { signal: controller.signal });
        if (res.status === 503) {
          setError(summon.place.unreachable);
          setResult(null);
        } else if (!res.ok) {
          setError(summon.errors.generic!);
          setResult(null);
        } else {
          setResult((await res.json()) as PlaceSearchResult);
          setMore([]);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError(summon.place.unreachable);
      } finally {
        setPending(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [q, kind, huc]);

  const loadMore = async () => {
    if (!result?.next_cursor) return;
    const params = new URLSearchParams({ q: q.trim(), cursor: result.next_cursor });
    if (kind) params.set("kind", kind);
    if (huc) params.set("huc", huc);
    const res = await fetch(`/api/summon/search?${params.toString()}`);
    if (!res.ok) return;
    const next = (await res.json()) as PlaceSearchResult;
    setMore((prev) => [...prev, ...next.places]);
    setResult({ ...next, places: result.places });
  };

  const places = [...(result?.places ?? []), ...more];

  return (
    <div className="stack">
      <label>
        <span className="eyebrow">{summon.place.searchLabel}</span>
        <input
          className="field"
          name="q"
          type="search"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={summon.place.searchPlaceholder}
          aria-describedby={listId}
        />
      </label>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 10rem" }}>
          <span className="eyebrow">{summon.place.kindLabel}</span>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{summon.place.kindAny}</option>
            {(result?.kinds ?? ["watershed", "monitoring_site"]).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 8rem" }}>
          <span className="eyebrow">{summon.place.hucLabel}</span>
          <input className="field" inputMode="numeric" pattern="\d{2,12}" value={huc} onChange={(e) => setHuc(e.target.value)} />
          <span className="faint" style={{ fontSize: "0.8rem" }}>{summon.place.hucHelp}</span>
        </label>
      </div>

      <div id={listId} aria-live="polite">
        {pending ? <p className="muted">{summon.place.searching}</p> : null}
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        {result && places.length === 0 && !pending ? <p className="muted">{summon.place.noResults}</p> : null}
        {places.length > 0 ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {places.map((p) => (
              <li key={p.id} className="sunken">
                <form action={action}>
                  <input type="hidden" name="draft_id" value={draftId} />
                  <input type="hidden" name="place_id" value={p.id} />
                  <p style={{ margin: 0, fontWeight: 600 }}>{p.name}</p>
                  <p className="faint" style={{ margin: "0.15rem 0 0.5rem", fontSize: "0.85rem", wordBreak: "break-all" }}>
                    {p.kind} · <code>{p.id}</code>
                    {p.huc12 ? ` · HUC-12 ${p.huc12}` : ""}
                  </p>
                  <button className="btn btn-primary" type="submit" aria-label={`${summon.place.choose}: ${p.name}`}>
                    {p.id === chosenId ? "Re-propose" : summon.place.choose}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        {result?.next_cursor ? (
          <p style={{ marginTop: "0.5rem" }}>
            <button type="button" className="btn" onClick={loadMore}>{summon.place.loadMore}</button>{" "}
            <span className="faint">{summon.place.more(result.total - places.length)}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
