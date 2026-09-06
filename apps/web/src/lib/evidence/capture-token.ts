/**
 * In-app capture token. `Capture.tsx` asks the server for one before opening
 * the camera; the upload route marks files carrying a valid token
 * `in_app_capture = true`. HMAC over claim + user + expiry. This proves the
 * file came through the in-app flow, not that the camera was real — *verify*
 * whether a stronger device attestation is wanted in phase 2.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const CAPTURE_TOKEN_TTL_S = 15 * 60;

function secret(): string {
  const s = process.env.CAPTURE_TOKEN_SECRET ?? process.env.CHAT_COOKIE_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("CAPTURE_TOKEN_SECRET (or BETTER_AUTH_SECRET) is required");
  return "kami-dev-capture-secret";
}

function sign(body: string, key = secret()): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function issueCaptureToken(claimId: string, userId: string, now = new Date(), key?: string): string {
  const exp = Math.floor(now.getTime() / 1000) + CAPTURE_TOKEN_TTL_S;
  const body = `${claimId}.${userId}.${exp}`;
  return `${Buffer.from(body).toString("base64url")}.${sign(body, key)}`;
}

export function verifyCaptureToken(token: string | null | undefined, claimId: string, userId: string, now = new Date(), key?: string): boolean {
  if (!token) return false;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return false;
  const body = Buffer.from(b64, "base64url").toString();
  const expected = sign(body, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const [c, u, expS] = body.split(".");
  if (c !== claimId || u !== userId) return false;
  const exp = Number(expS);
  return Number.isFinite(exp) && exp * 1000 >= now.getTime();
}
