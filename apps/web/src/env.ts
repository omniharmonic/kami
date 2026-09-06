/**
 * Server environment, parsed once with zod. `SKIP_ENV_VALIDATION=1` lets
 * `next build` run in CI without secrets; every consumer must then cope with
 * the value being absent (pages fall back to the last status file and empty states).
 * No `NEXT_PUBLIC_*` secret ever (CLAUDE.md).
 */
import { z } from "zod";

const optionalUrl = z.string().url().optional();
const nonEmpty = z.string().min(1);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  /** neon | pg — chosen automatically when unset */
  DB_DRIVER: z.enum(["neon", "pg"]).optional(),
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  BETTER_AUTH_URL: optionalUrl,
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default("Kami <hello@kami.local>"),
  KAMI_DATA_DIR: z.string().optional(),
  KAMI_DATA_BASE_URL: optionalUrl,
  HERMES_GATEWAY_URL: z.string().default("fake:"),
  HERMES_API_SERVER_KEY: z.string().optional(),
  CHAT_COOKIE_SECRET: z.string().optional(),
  SKIP_ENV_VALIDATION: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const required: Array<keyof Env> = ["DATABASE_URL", "BETTER_AUTH_SECRET"];

function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    if (source.SKIP_ENV_VALIDATION) return envSchema.parse({ NODE_ENV: source.NODE_ENV });
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && !source.SKIP_ENV_VALIDATION) {
    const missing = required.filter((k) => !env[k]);
    if (missing.length) throw new Error(`Missing required environment in production: ${missing.join(", ")}`);
  }
  return env;
}

export { parseEnv, nonEmpty };

export const env: Env = parseEnv();

export function isFakeGateway(url: string = env.HERMES_GATEWAY_URL): boolean {
  return url.startsWith("fake:");
}
