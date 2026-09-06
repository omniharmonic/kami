/**
 * Privy: lazily-provisioned embedded wallets (ADR-E07). The server half
 * (`server.ts`) verifies tokens and stores `privy_did` / `wallet_address`; the
 * client half (`client.tsx`, `hooks.ts`) is loaded only on the three surfaces
 * that need a signature, and is deliberately not re-exported here so a server
 * import of this module can never pull React or the SDK into a page bundle.
 */
export * from "./env";
export * from "./server";
