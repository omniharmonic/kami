/**
 * The donation rails: Stripe Checkout (one-time only), the Stripe webhook, the
 * direct-USDC path with its QR and its signed attribution, the monthly
 * conversion into the entity's Safe, the fee table, and the retire flow's
 * treasury half.
 *
 * Nothing in here signs for a guardian, holds a user key, or custodies fiat.
 */
export * from "./env";
export * from "./fees";
export * from "./stripe";
export * from "./webhook";
export * from "./direct";
export * from "./convert";
export * from "./retire";
export { donateCopy, feeSentence } from "./copy";
