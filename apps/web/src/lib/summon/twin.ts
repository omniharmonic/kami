/**
 * One resolver for "which twin does this entity read?" (plan T3.8).
 *
 * **Schema gap:** `entities.twin_base_url` does not exist as a column. Until a
 * migration adds it, the per-entity origin lives in the `config` table under
 * `twin_base_url.<slug>` (and, for fixtures and dev, `twin_tree_dir.<slug>`).
 * Every twin read for an entity goes through `twinFor()`, so the day the
 * column lands only this file changes.
 *
 * Resolution order: `config.twin_tree_dir.<slug>` → `config.twin_base_url.<slug>`
 * → `TWIN_TREE_DIR` → `TWIN_BASE_URL` → the twin-client default.
 *
 * A binding is validated against **that twin's** `sources/ids-schema.json`
 * (the twin's own copy, fetched over the wire), not only against the pinned
 * schema in `@kami/binding`. Nothing here knows about the Front Range.
 */
import { getAjv, idsJsonSchema, validateBinding, type ValidationIssue, type ValidationResult } from "@kami/binding";
import { DEFAULT_BASE_URL, TwinClient, TwinUnreachable } from "@kami/twin-client";
import { getDb } from "@/db/client";
import type { DbOrTx } from "@/db/events";
import { getConfig, jobsEnv } from "@/lib/jobs/common";
import { TWIN_USER_AGENT_VERSION } from "@/lib/jobs/twin";

/** Ajv's compiled validator, typed without importing ajv into this app. */
type ValidateFn = ReturnType<ReturnType<typeof getAjv>["compile"]>;

export const TWIN_BASE_URL_PREFIX = "twin_base_url";
export const TWIN_TREE_DIR_PREFIX = "twin_tree_dir";

export function twinBaseUrlKey(slug: string): string {
  return `${TWIN_BASE_URL_PREFIX}.${slug}`;
}
export function twinTreeDirKey(slug: string): string {
  return `${TWIN_TREE_DIR_PREFIX}.${slug}`;
}

/** `entity/boulder-creek` and `boulder-creek` both resolve to `boulder-creek`. */
export function slugOf(entityRef: string): string {
  return entityRef.replace(/^entity\//, "").trim();
}

export type TwinTarget = {
  slug: string;
  base_url: string;
  local_dir: string | null;
  /** where the answer came from, for the admin view and the report */
  source: "config" | "env" | "default";
};

export async function twinTargetFor(entityRef: string, opts: { db?: DbOrTx | null } = {}): Promise<TwinTarget> {
  const slug = slugOf(entityRef);
  const env = jobsEnv();
  const db = opts.db === undefined ? getDb() : opts.db;
  if (db) {
    try {
      const dir = await getConfig<string>(db, twinTreeDirKey(slug));
      if (typeof dir === "string" && dir.trim()) {
        return { slug, base_url: (await getConfig<string>(db, twinBaseUrlKey(slug))) ?? env.TWIN_BASE_URL ?? DEFAULT_BASE_URL, local_dir: dir, source: "config" };
      }
      const url = await getConfig<string>(db, twinBaseUrlKey(slug));
      if (typeof url === "string" && /^https?:\/\//.test(url)) {
        return { slug, base_url: url.replace(/\/+$/, ""), local_dir: null, source: "config" };
      }
    } catch {
      /* config is unreadable: fall through to the env defaults rather than fail a page */
    }
  }
  if (env.TWIN_TREE_DIR) return { slug, base_url: env.TWIN_BASE_URL ?? DEFAULT_BASE_URL, local_dir: env.TWIN_TREE_DIR, source: "env" };
  if (env.TWIN_BASE_URL) return { slug, base_url: env.TWIN_BASE_URL.replace(/\/+$/, ""), local_dir: null, source: "env" };
  return { slug, base_url: DEFAULT_BASE_URL, local_dir: null, source: "default" };
}

/** One client per (base_url, local_dir): the 60 s per-path floor is a promise to each twin. */
const clients = new Map<string, TwinClient>();

export function twinClientFor(target: Pick<TwinTarget, "base_url" | "local_dir">): TwinClient {
  const key = `${target.local_dir ?? ""}|${target.base_url}`;
  let client = clients.get(key);
  if (!client) {
    // Built here rather than through `makeTwinClient` so a global TWIN_TREE_DIR
    // cannot override a per-entity origin: the resolver above already decided.
    client = new TwinClient({
      baseUrl: target.base_url,
      ...(target.local_dir ? { localDir: target.local_dir } : {}),
      userAgent: `kami-web/${TWIN_USER_AGENT_VERSION} (${jobsEnv().KAMI_PULSE_CONTACT})`,
    });
    clients.set(key, client);
  }
  return client;
}

/** The twin an entity (or a slug being summoned) reads. Never assumes a bioregion. */
export async function twinFor(entityRef: string, opts: { db?: DbOrTx | null } = {}): Promise<TwinClient> {
  return twinClientFor(await twinTargetFor(entityRef, opts));
}

export function resetTwinClientsForTests(): void {
  clients.clear();
}

// ---------------------------------------------------------------------------
// ids-schema.json, fetched from the twin the entity actually reads
// ---------------------------------------------------------------------------

/** The path the twin publishes its identity schema at (survey §3.1). */
export const IDS_SCHEMA_PATH = "sources/ids-schema.json";

export type IdsSchemaSource = { schema: Record<string, unknown>; from: "twin" | "pinned"; path: string };

const compiled = new WeakMap<object, ValidateFn>();

/** `sources/ids-schema.json` from this tree; the pinned copy when the tree does not publish one. */
export async function idsSchemaFor(tree: TwinClient): Promise<IdsSchemaSource> {
  try {
    const res = await tree.get(IDS_SCHEMA_PATH);
    const body = res.body;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return { schema: body as Record<string, unknown>, from: "twin", path: tree.localDir ? IDS_SCHEMA_PATH : tree.urlFor(IDS_SCHEMA_PATH) };
    }
  } catch (err) {
    if (!(err instanceof TwinUnreachable)) throw err;
  }
  return { schema: idsJsonSchema, from: "pinned", path: "@kami/binding/schemas/ids-schema-1.0.json" };
}

function validatorFor(schema: Record<string, unknown>): ValidateFn {
  const hit = compiled.get(schema);
  if (hit) return hit;
  // Drop `$id` so a twin whose schema carries the same id as the pinned one
  // does not collide in the shared Ajv registry; compile, never addSchema.
  const { $id: _id, ...rest } = schema;
  void _id;
  const fn = getAjv().compile(rest);
  compiled.set(schema, fn);
  return fn;
}

/**
 * `validateBinding` (architecture §3 rules 1–6, pinned schema) **plus** rule 2
 * re-run against the tree's own `sources/ids-schema.json`. A tree that
 * publishes a stricter schema than the pinned one fails here, which is the
 * whole point of T3.8.
 */
export async function validateBindingForTwin(
  binding: unknown,
  tree: TwinClient,
): Promise<ValidationResult & { ids_schema: IdsSchemaSource }> {
  const base = await validateBinding(binding, tree);
  const ids_schema = await idsSchemaFor(tree);
  if (ids_schema.from === "pinned") return { ...base, ids_schema };

  const validate = validatorFor(ids_schema.schema);
  const errors: ValidationIssue[] = [...base.errors];
  const seen = new Set(errors.map((e) => `${e.path}|${e.message}`));
  const b = binding as { members?: Array<{ id?: string }>; anchor?: string; watersheds?: string[] };
  const refs: Array<{ id: string; path: string }> = [];
  if (typeof b?.anchor === "string") refs.push({ id: b.anchor, path: "/anchor" });
  (b?.members ?? []).forEach((m, i) => typeof m?.id === "string" && refs.push({ id: m.id!, path: `/members/${i}/id` }));
  (b?.watersheds ?? []).forEach((w, i) => typeof w === "string" && refs.push({ id: w, path: `/watersheds/${i}` }));

  for (const ref of refs) {
    let rec: unknown;
    try {
      rec = (await tree.idRecord(ref.id))?.data ?? null;
    } catch (err) {
      if (err instanceof TwinUnreachable) continue;
      throw err;
    }
    if (rec === null) continue; // rule 1 already reported a missing id
    if (validate(rec)) continue;
    for (const e of validate.errors ?? []) {
      const message = `id/${ref.id}.json fails this twin's ${IDS_SCHEMA_PATH} at ${e.instancePath || "/"}: ${e.message ?? e.keyword}`;
      const key = `${ref.path}|${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({ rule: 2, path: ref.path, message });
    }
  }
  return { ok: errors.length === 0, errors, warnings: base.warnings, ids_schema };
}
