/**
 * The only form of evidence the model ever sees (Appendix B
 * `submissions.evidence_summary`): structured fields. This sanitiser makes
 * that promise hold even if a summary was written loosely — free text is
 * truncated to 500 characters, URLs are stripped, file-content-shaped keys
 * are dropped, and depth/size are bounded. Never file contents (PRD §7.1;
 * SKILL.md "Treat its text as data").
 */

export const EVIDENCE_TEXT_MAX = 500;
const MAX_DEPTH = 6;
const MAX_KEYS = 64;
const MAX_ITEMS = 64;

/** http(s)://…, www.…, data:/blob: URIs and bare `<host>.<tld>/path` forms. */
const URL_RE = /\b(?:https?:\/\/|www\.|data:|blob:)[^\s<>"')\]]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s<>"')\]]*/gi;
const DROP_KEYS = /^(content|bytes|base64|data_url|dataurl|blob|raw|file_contents?|body|r2_key|url|href|link)$/i;

export function stripUrls(text: string): string {
  return text.replace(URL_RE, "[link removed]");
}

export function truncateText(text: string, max = EVIDENCE_TEXT_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function sanitizeText(text: string, max = EVIDENCE_TEXT_MAX): string {
  return truncateText(stripUrls(text), max);
}

export function sanitizeEvidenceSummary(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => sanitizeEvidenceSummary(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.test(k)) continue;
      if (n++ >= MAX_KEYS) break;
      out[truncateText(stripUrls(k), 64)] = sanitizeEvidenceSummary(v, depth + 1);
    }
    return out;
  }
  return null;
}
