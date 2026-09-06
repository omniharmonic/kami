/**
 * "What can my agent do once connected?" — answered from the registries, not
 * from prose.
 *
 * The platform half is read out of the running MCP server itself: we stand up
 * `createEntityMcpServer` on an in-memory transport and call `tools/list`, so
 * this page shows exactly the tool list an agent receives, including the
 * `readOnlyHint` annotation that says whether a call changes anything. Adding,
 * renaming or re-annotating a tool in `src/lib/mcp/server.ts` moves this page
 * on the next request; there is no second list to forget to update.
 *
 * The twin half comes from `twin-tools.ts`, which is generated from that
 * package's registry and pinned by a test that re-reads the real one.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createEntityMcpServer } from "@/lib/mcp/server";
import type { ToolContext } from "@/lib/mcp/tools";
import { TWIN_TOOLS, TWIN_IS_READ_ONLY, type TwinToolDef } from "./twin-tools";

export type ToolServerName = "platform" | "twin";

export type ToolInfo = {
  server: ToolServerName;
  name: string;
  title: string | null;
  /** one line: the first sentence of the registry's own description */
  summary: string;
  /** the whole registry description, for the people who want it */
  description: string;
  /** false = a read; true = it changes something on the platform */
  writes: boolean;
};

export type ToolCatalog = { platform: ToolInfo[]; twin: ToolInfo[] };

const SENTENCE_END = /(?<=[.!?])\s+/;

/** The first sentence, trimmed to something that fits on one line. */
export function firstSentence(text: string, max = 180): string {
  const first = (text ?? "").trim().split(SENTENCE_END)[0]?.trim() ?? "";
  if (!first) return "";
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A `ToolContext` that is never used: `createEntityMcpServer` reads the context
 * only inside a handler, and listing never runs one. Typed through `unknown`
 * rather than faked field by field, because inventing an entity row here would
 * be a lie about a database this function does not touch.
 */
function listingContext(): ToolContext {
  return { db: null, entity: null, binding: null, now: new Date(0) } as unknown as ToolContext;
}

/** `tools/list` against a server instance, over an in-memory transport. */
export async function listMcpTools(server: McpServer): Promise<ToolInfo[]> {
  const client = new Client({ name: "kami-connect-page", version: "0.1.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    return listed.tools.map((t) => {
      const description = t.description ?? "";
      return {
        server: "platform" as const,
        name: t.name,
        title: t.title ?? t.annotations?.title ?? null,
        summary: firstSentence(description),
        description,
        // Absent annotations are not a promise that a tool is safe: unknown
        // reads as "this one changes something", never the other way round.
        writes: t.annotations?.readOnlyHint !== true,
      };
    });
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export function twinToolInfo(tools: readonly TwinToolDef[] = TWIN_TOOLS): ToolInfo[] {
  return tools.map((t) => ({
    server: "twin" as const,
    name: t.name,
    title: null,
    summary: firstSentence(t.description),
    description: t.description,
    writes: !TWIN_IS_READ_ONLY,
  }));
}

export type ToolCatalogDeps = {
  /** the platform registry; the real MCP server by default */
  platformServer?: () => McpServer;
  /** the twin registry; the generated table by default */
  twinTools?: readonly TwinToolDef[];
};

/** Both tool lists, in the order each registry declares them. */
export async function toolCatalog(deps: ToolCatalogDeps = {}): Promise<ToolCatalog> {
  const make = deps.platformServer ?? (() => createEntityMcpServer(listingContext()));
  return { platform: await listMcpTools(make()), twin: twinToolInfo(deps.twinTools ?? TWIN_TOOLS) };
}

/**
 * The tool include lists in `profiles/templates/config.yaml.tmpl`: which of
 * these tools a Hermes profile is actually given. Parsed from the rendered
 * template so the Hermes tab cannot claim a tool the template does not include.
 */
export function includedTools(renderedConfigYaml: string, server: string): string[] {
  const block = new RegExp(`^\\s{2}${server}:\\n([\\s\\S]*?)(?=^\\s{2}\\S|\\Z)`, "m").exec(renderedConfigYaml);
  if (!block) return [];
  const include = /include:\s*\[([^\]]*)\]/.exec(block[1] ?? "");
  if (!include) return [];
  return (include[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
