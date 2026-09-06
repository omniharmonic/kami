/**
 * Builds the `McpServer` from the tool registry. Every tool result is JSON
 * text in the §4.2 envelope, checked against the contract (no geometry,
 * ≤ 16 KB) before it leaves; `tools/list` carries `_meta.contract_version`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolContext } from "./context.js";
import { assertNoGeometry, assertSize, ContractViolation, envelope, type Envelope } from "./envelope.js";
import { RESOURCES } from "./resources.js";
import { NotPublished } from "./twin.js";
import { PACKAGE_VERSION, TreeError } from "./tree.js";
import { TOOLS, ToolError, type ToolDef } from "./tools/index.js";

export const CONTRACT_VERSION = "1.0";
export const SERVER_NAME = "bioregionaltwin-mcp";

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface ToolFailure {
  error: { code: string; message: string; tool: string };
  as_of: string;
}

/** Runs one tool end to end (validate → handle → envelope → contract checks). */
export async function runTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<Envelope<Record<string, unknown>>> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new ToolError(`unknown tool ${name}`, "bad_input");
  const parsed = z.object(def.inputSchema).safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolError(`invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "$"} ${i.message}`).join("; ")}`, "bad_input");
  const outcome = await def.handler(parsed.data as Record<string, unknown>, ctx);
  const src = outcome.source_path;
  const out = envelope(
    {
      as_of: iso(ctx.now()),
      schema_version: (src ? ctx.reader.schemaVersion(src) : null) ?? ctx.reader.schemaVersion("latest/conditions.json") ?? ctx.reader.schemaVersion("id/index.json"),
      tree_generated_at: src ? ctx.reader.generatedAt(src) : null,
    },
    outcome.payload,
  );
  assertNoGeometry(out);
  assertSize(out);
  return out;
}

export function failureFor(name: string, err: unknown, now: number): ToolFailure {
  const code =
    err instanceof ToolError ? err.code
    : err instanceof NotPublished ? "not_found"
    : err instanceof ContractViolation ? "contract_violation"
    : err instanceof TreeError ? "tree_unreachable"
    : "internal";
  return { error: { code, message: err instanceof Error ? err.message : String(err), tool: name }, as_of: iso(now) };
}

export function toolListing(): { name: string; description: string; inputSchema: Record<string, unknown>; _meta: Record<string, unknown> }[] {
  return TOOLS.map((t: ToolDef) => ({
    name: t.name,
    description: t.deprecated ? `${t.description} [deprecated; replaced_by: ${t.replaced_by ?? "—"}]` : t.description,
    inputSchema: toInputJsonSchema(t),
    _meta: { contract_version: CONTRACT_VERSION, ...(t.deprecated ? { deprecated: true, replaced_by: t.replaced_by ?? null } : {}) },
  }));
}

function toInputJsonSchema(t: ToolDef): Record<string, unknown> {
  const schema = z.toJSONSchema(z.object(t.inputSchema), { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete schema["$schema"];
  return schema;
}

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: PACKAGE_VERSION },
    { instructions: `Read-only MCP over the Front Range Bioregional Twin (contract ${CONTRACT_VERSION}). Every reading carries time, unit, source_id, stale, staleness_s, source_status; absent means unknown. No geometry is ever returned. Start with get_entity_status (pulse) or find_places → get_place.` },
  );

  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema, _meta: { contract_version: CONTRACT_VERSION }, annotations: { readOnlyHint: true, openWorldHint: true } },
      (async (input: Record<string, unknown>) => {
        try {
          const out = await runTool(ctx, t.name, input);
          return { content: [{ type: "text" as const, text: JSON.stringify(out) }] };
        } catch (err) {
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(failureFor(t.name, err, ctx.now())) }] };
        }
      }) as never,
    );
  }

  for (const r of RESOURCES) {
    server.registerResource(r.name, r.uri, { description: r.description, mimeType: r.mimeType, _meta: { ttlMs: 300_000, cacheScope: "public" } }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: r.mimeType, text: await r.read(ctx) }],
    }));
  }

  // `tools/list` from our own registry so the result carries `_meta.contract_version`
  // (McpServer's default handler cannot add result-level _meta). Same tools, same
  // input schemas (zod → JSON Schema), registered after McpServer's own handler so it wins.
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolListing(), _meta: { contract_version: CONTRACT_VERSION, server: SERVER_NAME, version: PACKAGE_VERSION } }));

  return server;
}
