#!/usr/bin/env node
/**
 * `npx @bioregionaltwin/mcp --tree <url|dir> [--binding file.yaml]... [--contact addr]`
 * Speaks MCP over stdio. Logs go to stderr; stdout is the protocol.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { entitySlug, loadBindingFile, validateBinding, type Binding } from "./binding.js";
import type { ToolContext } from "./context.js";
import { createServer } from "./server.js";
import { DEFAULT_TREE, TreeReader } from "./tree.js";

export interface CliArgs {
  tree: string;
  bindings: string[];
  contact?: string;
  bindingOrigins: string[];
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { tree: process.env["TWIN_TREE"] ?? DEFAULT_TREE, bindings: [], bindingOrigins: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--tree") out.tree = next();
    else if (a.startsWith("--tree=")) out.tree = a.slice(7);
    else if (a === "--binding") out.bindings.push(next());
    else if (a.startsWith("--binding=")) out.bindings.push(a.slice(10));
    else if (a === "--contact") out.contact = next();
    else if (a.startsWith("--contact=")) out.contact = a.slice(10);
    else if (a === "--allow-binding-origin") out.bindingOrigins.push(next());
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

export const USAGE = `bioregionaltwin-mcp — read-only MCP server over the Front Range Bioregional Twin

  --tree <https-url | dir>        published tree (default ${DEFAULT_TREE}; env TWIN_TREE)
  --binding <file.yaml|json>      place-set binding; repeatable
  --contact <address>             contact in the User-Agent
  --allow-binding-origin <origin> origin resolve_entity may fetch binding_url from; repeatable
`;

export async function loadBindings(paths: string[], reader: TreeReader, log: (s: string) => void): Promise<Map<string, Binding>> {
  const map = new Map<string, Binding>();
  for (const p of paths) {
    const doc = await loadBindingFile(p);
    const r = await validateBinding(doc, reader);
    for (const w of r.warnings) log(`binding ${p}: warning: ${w}`);
    if (!r.ok || !r.binding) {
      for (const e of r.errors) log(`binding ${p}: error: ${e}`);
      throw new Error(`binding ${p} failed validation (${r.errors.length} error${r.errors.length === 1 ? "" : "s"})`);
    }
    map.set(entitySlug(r.binding.entity_id), r.binding);
    log(`binding ${p}: ${r.binding.entity_id} v${r.binding.binding_version} (${r.binding.members.length} members, ${r.binding.needs.length} needs)`);
  }
  return map;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const log = (s: string) => process.stderr.write(`[bioregionaltwin-mcp] ${s}\n`);
  const args = parseArgs(argv);
  if (args.help) {
    process.stderr.write(USAGE);
    return;
  }
  const reader = new TreeReader({ tree: args.tree, contact: args.contact });
  const bindings = await loadBindings(args.bindings, reader, log);
  const ctx: ToolContext = { reader, bindings, bindingOrigins: args.bindingOrigins, mode: "stdio", now: () => Date.now() };
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
  log(`serving ${reader.isRemote ? reader.base : `local tree ${reader.base}`} over stdio`);
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`[bioregionaltwin-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
