/**
 * The one anonymous chat cookie (§11 cookies/consent): a random id signed with
 * HMAC-SHA256 so a client cannot mint sessions to dodge the per-session limit.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

export const ANON_COOKIE = "kami_chat";
export const ANON_COOKIE_MAX_AGE_S = 60 * 60 * 24;

function secret(): string {
  const s = env.CHAT_COOKIE_SECRET ?? env.BETTER_AUTH_SECRET;
  if (s) return s;
  if (env.NODE_ENV === "production") throw new Error("CHAT_COOKIE_SECRET or BETTER_AUTH_SECRET is required");
  return "kami-dev-insecure-cookie-secret";
}

function sign(id: string, key = secret()): string {
  return createHmac("sha256", key).update(id).digest("base64url");
}

export function mintAnonKey(): string {
  const id = randomBytes(12).toString("base64url");
  return `${id}.${sign(id)}`;
}

export function verifyAnonKey(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(id);
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

/** Salted, daily-rotating hash of the client IP for the 60/day limit. Not reversible, not durable. */
export function ipHash(ip: string, day = new Date().toISOString().slice(0, 10)): string {
  return createHmac("sha256", secret()).update(`${day}|${ip}`).digest("hex").slice(0, 32);
}

/**
 * The client controls the left of `x-forwarded-for`, so reading entry 0 lets
 * anyone rotate a header to escape the per-IP rate limit. Each trusted proxy
 * appends the address it saw, so the honest address is the Nth from the right,
 * where N is how many proxies are actually in front of us: 1 on Vercel, more
 * behind an extra load balancer, 0 when nothing proxies us at all.
 * `TRUSTED_PROXY_HOPS` says which; the default of 1 matches the documented
 * deployment. Anything to the left of that is attacker-supplied and ignored.
 */
export function clientIp(headers: Headers): string {
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10);
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const chain = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (chain.length > 0) {
      const n = Number.isFinite(hops) && hops >= 0 ? hops : 1;
      // hops=1 → the last entry (what our proxy saw); hops=0 → also the last,
      // since there is then no forwarded chain we can trust at all.
      const index = Math.max(0, chain.length - Math.max(1, n));
      return chain[index]!;
    }
  }
  return headers.get("x-real-ip") ?? "0.0.0.0";
}
