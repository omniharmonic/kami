import { fileURLToPath } from "node:url";
import path from "node:path";

/** profiles/scripts/src/lib → repo root. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const PROFILES_DIR = path.join(REPO_ROOT, "profiles");
export const TEMPLATES_DIR = path.join(PROFILES_DIR, "templates");
export const HARD_RULES_PATH = path.join(TEMPLATES_DIR, "SOUL.hard-rules.md");
export const CONFIG_TMPL_PATH = path.join(TEMPLATES_DIR, "config.yaml.tmpl");
export const ENV_TMPL_PATH = path.join(TEMPLATES_DIR, "env.tmpl");
export const CRON_YAML_PATH = path.join(TEMPLATES_DIR, "cron.yaml");
export const SKILL_DIR = path.join(TEMPLATES_DIR, "skills", "entity-steward");

export function profileDir(slug: string): string {
  return path.join(PROFILES_DIR, slug);
}
