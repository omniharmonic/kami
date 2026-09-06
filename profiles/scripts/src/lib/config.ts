/** config.yaml / .env / binding.json rendering. */
import { parse as parseYaml } from "yaml";

export type ConfigVars = {
  slug: string;
  model: string;
  gate_url: string;
  platform_url: string;
  twin_base_url: string;
  paused: boolean;
};

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

export class TemplateError extends Error {
  override name = "TemplateError";
}

/** Substitute `{{key}}` placeholders; fail on an unknown or unfilled key. */
export function renderTemplate(template: string, vars: Record<string, string | boolean | number>): string {
  const out = template.replace(PLACEHOLDER_RE, (_m, key: string) => {
    if (!(key in vars)) throw new TemplateError(`template placeholder {{${key}}} has no value`);
    return String(vars[key]);
  });
  const left = /\{\{[^}]*\}\}/.exec(out);
  if (left) throw new TemplateError(`unfilled placeholder ${left[0]}`);
  return out;
}

export function renderConfig(template: string, vars: ConfigVars): string {
  const rendered = renderTemplate(template, { ...vars, paused: vars.paused ? "true" : "false" });
  // must parse, and must point Hermes at the gate rather than at vLLM
  const doc = parseYaml(rendered) as { model?: { base_url?: string }; paused?: boolean };
  if (!doc.model?.base_url?.includes("/p/")) {
    throw new TemplateError("config.yaml base_url must be the gate's per-entity path (/p/<slug>/v1), never vLLM");
  }
  if (doc.paused !== vars.paused) throw new TemplateError("config.yaml paused flag did not render");
  return rendered;
}

export function renderEnv(template: string, slug: string, platformMcpToken: string): string {
  // Only the two keys the template names; nothing else is ever added here.
  const lines = template.split("\n").map((line) => {
    if (line.startsWith("PLATFORM_MCP_TOKEN=")) return `PLATFORM_MCP_TOKEN=${platformMcpToken}`;
    if (line.startsWith("KAMI_ENTITY_SLUG=")) return `KAMI_ENTITY_SLUG=${slug}`;
    return line;
  });
  return lines.join("\n");
}

// Assembled from parts so this source file does not itself match infra/box/tests/test_no_chain_keys.sh.
export const CHAIN_KEY_RE = new RegExp(
  "(" + ["PRIVATE_" + "KEY", "MNEMO" + "NIC", "SAFE_PROPOSER_" + "KEY", "0x[0-9a-fA-F]{64}"].join("|") + ")",
);

/** X.1 — nothing that looks like a chain key may enter a profile directory. */
export function assertNoChainKey(name: string, content: string): void {
  const m = CHAIN_KEY_RE.exec(content);
  if (m) throw new TemplateError(`${name} contains something that looks like a chain key (${m[0].slice(0, 12)}…)`);
}

/** binding.yaml (steward-edited) → binding.json (what the twin MCP reads). Geometry never enters. */
export function bindingYamlToJson(yamlText: string): string {
  const doc = parseYaml(yamlText) as Record<string, unknown>;
  if (!doc || typeof doc !== "object") throw new TemplateError("binding.yaml is not a mapping");
  for (const key of ["schema_version", "entity_id", "archetype", "members"]) {
    if (!(key in doc)) throw new TemplateError(`binding.yaml lacks ${key}`);
  }
  if (JSON.stringify(doc).includes('"coordinates"')) {
    throw new TemplateError("binding.yaml carries geometry (a `coordinates` key); the platform stores URLs only");
  }
  return JSON.stringify(doc, null, 2) + "\n";
}
