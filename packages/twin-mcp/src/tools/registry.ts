import type { ZodRawShape } from "zod";
import type { ToolContext, ToolOutcome } from "../context.js";
import type { Binding } from "../binding.js";
import { hucCodeOf } from "../binding.js";

export interface ToolDef<S extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: S;
  /** `deprecated: true` + `replaced_by` announce a removal ≥ 90 days ahead (§4.4). */
  deprecated?: boolean;
  replaced_by?: string;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>;
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "bad_input" | "no_binding" | "not_allowed" | "unavailable" = "bad_input",
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function defineTool<S extends ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/** The binding a tool acts on: the named one, or the only one configured. */
export function bindingFor(ctx: ToolContext, entity?: string | null): Binding {
  if (entity) {
    const slug = entity.replace(/^entity\//, "");
    const b = ctx.bindings.get(slug);
    if (!b) throw new ToolError(`no binding configured for entity "${entity}" (configured: ${[...ctx.bindings.keys()].join(", ") || "none"})`, "no_binding");
    return b;
  }
  if (ctx.bindings.size === 1) return [...ctx.bindings.values()][0]!;
  if (ctx.bindings.size === 0) throw new ToolError(ctx.mode === "worker" ? "this server hosts no bindings; pass a binding_url to resolve_entity or run the stdio package with --binding" : "no --binding configured", "no_binding");
  throw new ToolError(`several bindings configured; pass entity (one of ${[...ctx.bindings.keys()].join(", ")})`, "bad_input");
}

export { hucCodeOf };
