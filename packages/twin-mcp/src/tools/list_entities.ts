import { entitySlug } from "../binding.js";
import { defineTool } from "./registry.js";

export const list_entities = defineTool({
  name: "list_entities",
  description: "Bindings this server was started with (stdio: --binding files). The hosted Worker returns {entities: []} — the twin does not host an entity registry.",
  inputSchema: {},
  async handler(_input, ctx) {
    if (ctx.mode === "worker") return { payload: { entities: [], note: "the twin hosts no entity registry; pass a binding_url to resolve_entity" } };
    const entities = [...ctx.bindings.values()].map((b) => ({
      entity_id: b.entity_id,
      slug: entitySlug(b.entity_id),
      archetype: b.archetype,
      anchor: b.anchor,
      binding_version: b.binding_version,
      frozen_at: b.frozen_at,
      members: b.members.length,
      watersheds: b.watersheds.length,
      needs: b.needs.map((n) => n.need),
    }));
    return { payload: { entities } };
  },
});
