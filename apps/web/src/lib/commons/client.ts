/**
 * `ParachuteClient` — the entities vault's REST API (survey §7.2, §7.4,
 * §7.8): base `${hub}/vault/${vault}/api`, bearer token, note URLs with the
 * path percent-encoded as ONE segment, PATCH with `if_updated_at`, a
 * 409/412/428 → refetch → `ConflictError(fresh)` (the caller re-splices and
 * retries once), writes paced 120 ms apart, and — deliberately — no `force`.
 *
 * Env: `PARACHUTE_HUB_URL`, `PARACHUTE_ENTITIES_VAULT` (default `entities`),
 * `PARACHUTE_ENTITIES_TOKEN`. Never in a `NEXT_PUBLIC_*` var.
 */
import { z } from "zod";

export const WRITE_PACING_MS = 120;

export type Note = {
  id?: string | null;
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  updated_at: string | null;
};

export class ConflictError extends Error {
  override name = "ConflictError";
  constructor(
    public readonly fresh: Note | null,
    public readonly status: number,
  ) {
    super(`note changed underneath us (HTTP ${status})`);
  }
}

export class ParachuteError extends Error {
  override name = "ParachuteError";
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const commonsEnvSchema = z.object({
  PARACHUTE_HUB_URL: z.string().url(),
  PARACHUTE_ENTITIES_VAULT: z.string().min(1).default("entities"),
  PARACHUTE_ENTITIES_TOKEN: z.string().min(1),
  /** the front-range publication the wikilinks fall back to */
  COMMONS_FRONT_RANGE_BASE_URL: z.string().url().default("https://prism.omniharmonic.com/p/front-range"),
});

export type CommonsEnv = z.infer<typeof commonsEnvSchema>;

export function commonsEnvFrom(source: NodeJS.ProcessEnv = process.env): CommonsEnv | null {
  if (!source.PARACHUTE_HUB_URL || !source.PARACHUTE_ENTITIES_TOKEN) return null;
  const parsed = commonsEnvSchema.safeParse(source);
  if (!parsed.success) throw new Error(`commons misconfigured: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return parsed.data;
}

export type ParachuteClientOptions = {
  hubUrl: string;
  vault: string;
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** The note path percent-encoded as one segment (`/` → `%2F`); multi-segment paths 403 (survey §7.2). */
export function encodeNotePath(path: string): string {
  return encodeURIComponent(path.replace(/^\/+/, ""));
}

function toNote(raw: unknown, fallbackPath: string): Note {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const inner = (r["note"] && typeof r["note"] === "object" ? (r["note"] as Record<string, unknown>) : r) as Record<string, unknown>;
  return {
    id: typeof inner["id"] === "string" ? inner["id"] : null,
    path: typeof inner["path"] === "string" ? inner["path"] : fallbackPath,
    content: typeof inner["content"] === "string" ? inner["content"] : "",
    metadata: inner["metadata"] && typeof inner["metadata"] === "object" ? (inner["metadata"] as Record<string, unknown>) : {},
    tags: Array.isArray(inner["tags"]) ? inner["tags"].filter((t): t is string => typeof t === "string") : [],
    updated_at: typeof inner["updated_at"] === "string" ? inner["updated_at"] : typeof inner["updatedAt"] === "string" ? inner["updatedAt"] : null,
  };
}

export class ParachuteClient {
  readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastWriteAt = 0;

  constructor(opts: ParachuteClientOptions) {
    this.base = `${opts.hubUrl.replace(/\/+$/, "")}/vault/${encodeURIComponent(opts.vault)}/api`;
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  static fromEnv(env: CommonsEnv | null = commonsEnvFrom(), extra: Partial<ParachuteClientOptions> = {}): ParachuteClient | null {
    if (!env) return null;
    return new ParachuteClient({ hubUrl: env.PARACHUTE_HUB_URL, vault: env.PARACHUTE_ENTITIES_VAULT, token: env.PARACHUTE_ENTITIES_TOKEN, ...extra });
  }

  noteUrl(path: string): string {
    return `${this.base}/notes/${encodeNotePath(path)}`;
  }

  private headers(json = false): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, accept: "application/json", ...(json ? { "content-type": "application/json" } : {}) };
  }

  private async pace(): Promise<void> {
    const wait = this.lastWriteAt + WRITE_PACING_MS - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastWriteAt = this.now();
  }

  async getNote(path: string): Promise<Note | null> {
    const res = await this.fetchImpl(this.noteUrl(path), { headers: this.headers(), cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new ParachuteError(res.status, `GET ${path}: HTTP ${res.status}`);
    return toNote(await res.json(), path);
  }

  async createNote(input: { path: string; content: string; tags: string[]; metadata: Record<string, unknown> }): Promise<Note> {
    await this.pace();
    const res = await this.fetchImpl(`${this.base}/notes`, { method: "POST", headers: this.headers(true), body: JSON.stringify(input) });
    if (res.status === 409) {
      const fresh = await this.getNote(input.path);
      throw new ConflictError(fresh, res.status);
    }
    if (!res.ok) throw new ParachuteError(res.status, `POST notes ${input.path}: HTTP ${res.status}`);
    return toNote(await res.json().catch(() => ({})), input.path);
  }

  /**
   * PATCH with `if_updated_at` (428 without it). On 409/412/428 the fresh note
   * is fetched and thrown as `ConflictError` so the caller can re-splice once.
   * Tags are NOT sent: `add_tags` on PATCH is a silent no-op (survey §7.5).
   */
  async patchNote(path: string, input: { content?: string; metadata?: Record<string, unknown>; if_updated_at: string | null }): Promise<Note> {
    await this.pace();
    const res = await this.fetchImpl(this.noteUrl(path), { method: "PATCH", headers: this.headers(true), body: JSON.stringify(input) });
    if (res.status === 409 || res.status === 412 || res.status === 428) {
      const fresh = await this.getNote(path).catch(() => null);
      throw new ConflictError(fresh, res.status);
    }
    if (!res.ok) throw new ParachuteError(res.status, `PATCH ${path}: HTTP ${res.status}`);
    return toNote(await res.json().catch(() => ({})), path);
  }
}

/**
 * Anonymous read of a published note in another publication (the front-range
 * commons; CORS `*`, no token — survey §7.2). Returns null on any failure.
 */
export async function readPublicNote(publicationBase: string, path: string, fetchImpl: typeof fetch = fetch): Promise<Note | null> {
  try {
    const api = publicationBase.replace(/\/+$/, "").replace(/\/p\//, "/api/p/");
    const res = await fetchImpl(`${api}/notes/${encodeNotePath(path)}`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    return toNote(await res.json(), path);
  } catch {
    return null;
  }
}
