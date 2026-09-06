/**
 * CARE / Indigenous data (architecture §11): TK-labelled commons material is
 * never quoted by the entity. `tkSafe` inspects a note's metadata for Local
 * Contexts TK / BC labels (`tk_labels`, `bc_labels`, `local_contexts`,
 * `labels` entries like "TK A", "BC P", "TK Attribution") and the commons'
 * `indigenous_governed` / `sensitivity` flags, and refuses the note when any
 * is present. Refusal is the safe direction: an unparseable label refuses.
 */
import type { Note } from "./client";

const LABEL_KEY_RE = /^(tk|bc)([_\-\s].*)?$|^(tk|bc)_?labels?$|^local[_\-\s]?contexts?$|^traditional[_\-\s]?knowledge/i;
const LABEL_VALUE_RE = /\b(TK|BC)\s?[A-Z]{1,3}\b|\b(TK|BC)\s?(Attribution|Verified|Non-Verified|Seasonal|Outreach|Multiple Communities|Community Voice|Creative|Culturally Sensitive|Secret|Sacred|Open to Commercialization|Non-Commercial|Provenance|Research Use|Consent)\b|\btraditional knowledge label/i;

export type TkCheck = { ok: true; note: Note } | { ok: false; reason: string; key?: string };

function scan(value: unknown, path: string, depth: number): { key: string; reason: string } | null {
  if (depth > 5) return null;
  if (typeof value === "string") return LABEL_VALUE_RE.test(value) ? { key: path, reason: `label "${value}"` } : null;
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const hit = scan(v, `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = path ? `${path}.${k}` : k;
      if (LABEL_KEY_RE.test(k) && v !== null && v !== undefined && v !== false && v !== "" && !(Array.isArray(v) && v.length === 0)) {
        return { key, reason: `metadata key "${k}" carries a TK/BC label` };
      }
      const hit = scan(v, key, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

export function tkSafe(note: Note | null | undefined): TkCheck {
  if (!note) return { ok: false, reason: "no note" };
  const meta = note.metadata ?? {};
  if (meta["indigenous_governed"] === true) return { ok: false, reason: "indigenous_governed", key: "indigenous_governed" };
  const sensitivity = typeof meta["sensitivity"] === "string" ? meta["sensitivity"].toLowerCase() : "";
  if (sensitivity && sensitivity !== "public" && sensitivity !== "generalized") return { ok: false, reason: `sensitivity ${sensitivity}`, key: "sensitivity" };
  const hit = scan(meta, "", 0);
  if (hit) return { ok: false, reason: hit.reason, key: hit.key };
  for (const tag of note.tags ?? []) {
    if (/^(tk|bc)(\/|$)|traditional-knowledge|indigenous/i.test(tag)) return { ok: false, reason: `tag "${tag}"`, key: "tags" };
  }
  return { ok: true, note };
}

/** A short, safe excerpt of a note's prose (first paragraph, no fences, no links), or null when refused. */
export function safeExcerpt(note: Note | null | undefined, max = 280): string | null {
  const check = tkSafe(note);
  if (!check.ok) return null;
  const body = check.note.content
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_m, p: string, _b, l?: string) => l ?? p.split("/").pop() ?? p)
    .replace(/https?:\/\/\S+/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim())
    .find((p) => p.length > 40);
  if (!body) return null;
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}
