/**
 * Privy configuration. The app id is not a secret but is still passed to the
 * browser as a prop from a server component rather than as `NEXT_PUBLIC_*`, so
 * the "no `NEXT_PUBLIC_*`" rule needs no exception and no lint suppression.
 */
import { z } from "zod";

export const privyEnvSchema = z.object({
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  /** the app's verification key (Privy dashboard), used to verify tokens offline */
  PRIVY_VERIFICATION_KEY: z.string().min(1).optional(),
  /** Coinbase (or other) off-ramp deep link shown on /me/wallet (*verify* availability) */
  OFFRAMP_URL: z.string().url().optional(),
  NODE_ENV: z.string().optional(),
});

export type PrivyEnv = z.infer<typeof privyEnvSchema>;

export function privyEnv(source: NodeJS.ProcessEnv = process.env): PrivyEnv {
  const parsed = privyEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  console.warn("[privy] env issues:", parsed.error.issues.map((i) => i.path.join(".")).join(", "));
  return privyEnvSchema.parse({ NODE_ENV: source.NODE_ENV });
}

/** Configured only when both halves are present; a half-set app is treated as unset. */
export function privyConfigured(env: PrivyEnv = privyEnv()): boolean {
  return Boolean(env.PRIVY_APP_ID && env.PRIVY_APP_SECRET);
}
