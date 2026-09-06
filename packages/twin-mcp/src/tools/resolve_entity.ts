import { z } from "zod";
import { ENTITY_ID, TWIN_ID, parseBindingText, proposeBinding, validateBinding, type Binding } from "../binding.js";
import { defineTool, ToolError } from "./registry.js";

function bindingOut(b: Binding | null) {
  return b ? { ...b } : null;
}

export const resolve_entity = defineTool({
  name: "resolve_entity",
  description:
    "Resolve `query` to a validated place-set binding: an entity slug configured on this server, a twin watershed/stream id (→ a proposed binding, binding_version 0, unreviewed), or an https binding_url on an allowlisted origin (→ fetched and validated against schema + rules 1–6).",
  inputSchema: { query: z.string().min(1).max(512) },
  async handler(input, ctx) {
    const q = (input["query"] as string).trim();
    if (/^https?:\/\//i.test(q)) {
      const url = new URL(q);
      const allowed = ctx.bindingOrigins.some((o) => o === url.origin || o === "*");
      if (!allowed) throw new ToolError(`origin ${url.origin} is not allowlisted for binding_url (allowed: ${ctx.bindingOrigins.join(", ") || "none"})`, "not_allowed");
      const res = await fetch(q, { headers: { "User-Agent": ctx.reader.userAgent, Accept: "application/json, application/yaml, text/yaml" } });
      if (!res.ok) throw new ToolError(`binding_url returned ${res.status}`, "not_found");
      const doc = parseBindingText(await res.text(), url.pathname);
      const r = await validateBinding(doc, ctx.reader);
      return { payload: { resolved_from: "binding_url", ok: r.ok, errors: r.errors, warnings: r.warnings, proposed: false, binding: bindingOut(r.binding) }, source_path: "id/index.json" };
    }
    const slug = q.replace(/^entity\//, "");
    if (ctx.bindings.has(slug) || ENTITY_ID.test(q)) {
      const b = ctx.bindings.get(slug);
      if (!b) throw new ToolError(`no binding configured for ${q}`, "no_binding");
      const r = await validateBinding(b, ctx.reader);
      return { payload: { resolved_from: "configured", ok: r.ok, errors: r.errors, warnings: r.warnings, proposed: false, binding: bindingOut(r.binding) }, source_path: "id/index.json" };
    }
    if (TWIN_ID.test(q)) {
      const proposal = await proposeBinding(ctx.reader, q, ctx.now());
      if (!proposal) throw new ToolError(`${q} is not a watershed, stream or bioregion with reporting members in this tree`, "not_found");
      const r = await validateBinding(proposal, ctx.reader);
      return { payload: { resolved_from: "twin_id", ok: r.ok, errors: r.errors, warnings: r.warnings, proposed: true, binding: bindingOut(r.binding), note: "a proposal: binding_version 0, no reviewer; a steward must freeze it before it is a body" }, source_path: "id/index.json" };
    }
    throw new ToolError(`query must be an entity slug, a twin id (ns/slug) or an https binding_url`, "bad_input");
  },
});
