/**
 * Environment for the donation rails. Read here with zod, not in `src/env.ts`
 * (that file is shared and owned elsewhere). Nothing here is `NEXT_PUBLIC_*`;
 * no key is ever logged or returned to a caller.
 */
import { z } from "zod";

export const donationsEnvSchema = z.object({
  /** Stripe restricted key for the wrapper's account (`config.stripe_account_id`). */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  /** `whsec_…` for `POST /api/webhooks/stripe`; without it the route refuses everything. */
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Canonical origin for Checkout's success/cancel URLs. */
  BETTER_AUTH_URL: z.string().url().optional(),
  NODE_ENV: z.string().optional(),
});

export type DonationsEnv = z.infer<typeof donationsEnvSchema>;

export function donationsEnv(source: NodeJS.ProcessEnv = process.env): DonationsEnv {
  const parsed = donationsEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  console.warn("[donations] env issues:", parsed.error.issues.map((i) => i.path.join(".")).join(", "));
  return donationsEnvSchema.parse({ NODE_ENV: source.NODE_ENV });
}

export function originFrom(env: DonationsEnv = donationsEnv()): string {
  return (env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
