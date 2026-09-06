/**
 * Environment for the signing service, treasury routes and the money crons.
 * Read here with zod (not in `src/env.ts`, which is shared and owned elsewhere).
 * Nothing here is `NEXT_PUBLIC_*`; the key material itself never passes
 * through this module except `KAMI_LOCAL_KEYS_JSON` (dev/test only).
 */
import { z } from "zod";

export const signingEnvSchema = z.object({
  /** `local` (dev/test), `privy` (Privy server wallets), `aws-kms` (stub). */
  SIGNING_BACKEND: z.enum(["local", "privy", "aws-kms"]).optional(),
  /** dev/test only: `{"attester":"0x…","proposer:boulder-creek":"0x…"}` */
  KAMI_LOCAL_KEYS_JSON: z.string().optional(),
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  /** the app's authorization keypair private key (Privy dashboard) */
  PRIVY_AUTHORIZATION_KEY: z.string().min(1).optional(),
  /** `{"attester":{"walletId":"…","address":"0x…"},"proposer:<slug>":{…}}` */
  PRIVY_WALLET_IDS_JSON: z.string().optional(),
  AWS_KMS_KEY_IDS_JSON: z.string().optional(),
  /** 84532 (default) or 8453 — the same switch `@kami/chain` uses */
  CHAIN_ID: z.string().optional(),
  RPC_URL_BASE: z.string().url().optional(),
  SAFE_API_KEY: z.string().min(1).optional(),
  /** shared secret the keyless treasury MCP presents until `src/lib/mcp/tokens.ts` lands */
  PLATFORM_MCP_TOKEN: z.string().min(1).optional(),
  /** EAS GraphQL endpoint (*verify* for Base); unset ⇒ reconciliation marks UIDs `unverified` */
  EAS_GRAPHQL_URL: z.string().url().optional(),
  /** ETH float below which the relayer refuses to execute (default 0.01) */
  RELAYER_MIN_ETH: z.string().optional(),
  /** public base for evidence thumbnails on the guardian screen (optional) */
  KAMI_EVIDENCE_BASE_URL: z.string().url().optional(),
  KAMI_DATA_BASE_URL: z.string().url().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  NODE_ENV: z.string().optional(),
});

export type SigningEnv = z.infer<typeof signingEnvSchema>;

export function signingEnv(source: NodeJS.ProcessEnv = process.env): SigningEnv {
  const parsed = signingEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  console.warn("[signing] env issues:", parsed.error.issues.map((i) => i.path.join(".")).join(", "));
  return signingEnvSchema.parse({ NODE_ENV: source.NODE_ENV });
}

export function isProduction(source: NodeJS.ProcessEnv = process.env): boolean {
  return source.NODE_ENV === "production";
}
