/**
 * `config.yaml` for a Hermes profile, rendered from
 * `profiles/templates/config.yaml.tmpl` (architecture §5.1). The template is
 * the source of truth and is shared with `profiles/scripts`; this module only
 * fills the six placeholders and re-checks the two invariants that matter:
 * Hermes must point at the gate (never at vLLM, ADR-E04) and the `paused`
 * flag must actually have rendered (§5.9).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const TEMPLATE_REL = path.join("profiles", "templates", "config.yaml.tmpl");
const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

export class TemplateError extends Error {
  override name = "TemplateError";
}

export type ProfileConfigVars = {
  slug: string;
  model?: string;
  gate_url?: string;
  platform_url?: string;
  twin_base_url?: string;
  paused: boolean;
};

export const PROFILE_DEFAULTS = {
  model: "qwen3.5-9b",
  platform_url: "http://127.0.0.1:3000",
  twin_base_url: "https://data.bioregionaltwin.org",
} as const;

export function templateCandidates(cwd: string = process.cwd()): string[] {
  const fromEnv = process.env.KAMI_CONFIG_TEMPLATE_PATH;
  const out = fromEnv ? [fromEnv] : [];
  let dir = path.resolve(cwd);
  for (let i = 0; i < 6; i++) {
    out.push(path.join(dir, TEMPLATE_REL));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

let cachedTemplate: string | null = null;

export async function loadConfigTemplate(file?: string): Promise<string> {
  if (cachedTemplate && !file) return cachedTemplate;
  const tried: string[] = [];
  for (const candidate of file ? [file] : templateCandidates()) {
    try {
      const text = await readFile(candidate, "utf8");
      if (!file) cachedTemplate = text;
      return text;
    } catch {
      tried.push(candidate);
    }
  }
  throw new TemplateError(`config.yaml.tmpl is not readable; tried ${tried.join(", ")}`);
}

export function resetConfigTemplateCacheForTests(): void {
  cachedTemplate = null;
}

export function fillTemplate(template: string, vars: Record<string, string | boolean | number>): string {
  const out = template.replace(PLACEHOLDER_RE, (_m, key: string) => {
    if (!(key in vars)) throw new TemplateError(`template placeholder {{${key}}} has no value`);
    return String(vars[key]);
  });
  const left = /\{\{[^}]*\}\}/.exec(out);
  if (left) throw new TemplateError(`unfilled placeholder ${left[0]}`);
  return out;
}

export async function renderProfileConfig(vars: ProfileConfigVars, templateFile?: string): Promise<string> {
  const template = await loadConfigTemplate(templateFile);
  const rendered = fillTemplate(template, {
    slug: vars.slug,
    model: vars.model ?? PROFILE_DEFAULTS.model,
    gate_url: vars.gate_url ?? `http://127.0.0.1:8001/p/${vars.slug}/v1`,
    platform_url: (vars.platform_url ?? process.env.PLATFORM_URL ?? PROFILE_DEFAULTS.platform_url).replace(/\/+$/, ""),
    twin_base_url: (vars.twin_base_url ?? PROFILE_DEFAULTS.twin_base_url).replace(/\/+$/, ""),
    paused: vars.paused ? "true" : "false",
  });
  const doc = parseYaml(rendered) as { model?: { base_url?: string }; paused?: boolean };
  if (!doc.model?.base_url?.includes("/p/")) {
    throw new TemplateError("config.yaml base_url must be the gate's per-entity path (/p/<slug>/v1), never vLLM");
  }
  if (doc.paused !== vars.paused) throw new TemplateError("config.yaml paused flag did not render");
  return rendered;
}
