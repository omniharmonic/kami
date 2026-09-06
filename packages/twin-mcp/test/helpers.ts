import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entitySlug, loadBindingFile, validateBinding, type Binding } from "../src/binding.js";
import type { ToolContext } from "../src/context.js";
import { TreeReader } from "../src/tree.js";

export const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_STALE = join(PKG, "fixtures/public");
export const FIXTURE_LIVE = join(PKG, "fixtures/public-live");
export const BINDING_FILE = join(PKG, "fixtures/bindings/boulder-creek.yaml");
/** The fixture build's clock: every fixture timestamp is relative to it. */
export const NOW = Date.parse("2026-09-06T05:00:00Z");

export async function loadFixtureBinding(reader: TreeReader): Promise<Binding> {
  const r = await validateBinding(await loadBindingFile(BINDING_FILE), reader);
  if (!r.ok || !r.binding) throw new Error(`fixture binding invalid: ${r.errors.join("; ")}`);
  return r.binding;
}

export async function makeCtx(tree = FIXTURE_STALE, opts: { now?: number; binding?: boolean; mode?: ToolContext["mode"] } = {}): Promise<ToolContext> {
  const reader = new TreeReader({ tree });
  const bindings = new Map<string, Binding>();
  if (opts.binding !== false) {
    const b = await loadFixtureBinding(reader);
    bindings.set(entitySlug(b.entity_id), b);
  }
  return { reader, bindings, bindingOrigins: [], mode: opts.mode ?? "test", now: () => opts.now ?? NOW };
}

/** Every object that looks like a reading: has `property`, `source_id` and `value`, and is not a facts atom (series summaries have no `value`). */
export function collectReadings(v: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(v)) v.forEach((x) => collectReadings(x, acc));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["property"] === "string" && typeof o["source_id"] === "string" && "value" in o && !("kind" in o)) acc.push(o);
    for (const x of Object.values(o)) collectReadings(x, acc);
  }
  return acc;
}

export function collectKeys(v: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => collectKeys(x, acc));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as object)) { acc.add(k); collectKeys(x, acc); }
  return acc;
}
