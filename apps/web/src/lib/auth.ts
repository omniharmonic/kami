/**
 * Better Auth 1.7 with the magic-link plugin (ADR-E07, T1.2). No password
 * anywhere. Sessions are 30-day cookies. The age gate: `/sign-in/magic-link`
 * is refused unless the request declares "I am 13 or older"
 * (`metadata.age_gate_ok === true` or header `x-kami-age-gate: confirmed`);
 * the only path that creates a user is a verified magic link, so
 * `users.age_gate_ok` is set true on creation.
 *
 * *verify* (docs/verify.md #12): plugin import paths and option names are as
 * shipped in better-auth@1.7.3 — confirmed by the vitest auth suite against
 * PGlite. Neon Auth remains the documented fallback.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins/magic-link";
import { Resend } from "resend";
import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { auth as copy } from "@/copy";
import { env } from "@/env";

export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;
export const MAGIC_LINK_TTL_S = 60 * 10;
export const AGE_GATE_HEADER = "x-kami-age-gate";

export type SendMagicLink = (data: { email: string; url: string; token: string }) => Promise<void>;

export type CreateAuthOptions = {
  db: Db;
  secret: string;
  baseURL: string;
  sendMagicLink: SendMagicLink;
  /** extra plugins (the Next cookies plugin in the app; none in tests) */
  plugins?: Parameters<typeof betterAuth>[0]["plugins"];
};

export function ageGateDeclared(body: unknown, headers: Headers | undefined): boolean {
  const meta = (body as { metadata?: { age_gate_ok?: unknown } } | undefined)?.metadata;
  if (meta?.age_gate_ok === true) return true;
  return headers?.get(AGE_GATE_HEADER) === "confirmed";
}

export function createAuth(opts: CreateAuthOptions) {
  return betterAuth({
    appName: "Kami",
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: drizzleAdapter(opts.db, {
      provider: "pg",
      schema: { users: schema.users, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: false },
    user: {
      modelName: "users",
      additionalFields: {
        age_gate_ok: { type: "boolean", required: false, defaultValue: false, input: false, fieldName: "ageGateOk" },
        platform_admin: { type: "boolean", required: false, defaultValue: false, input: false, fieldName: "platformAdmin" },
      },
    },
    session: {
      expiresIn: SESSION_MAX_AGE_S,
      updateAge: 60 * 60 * 24,
    },
    advanced: { cookiePrefix: "kami" },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/magic-link" && !ageGateDeclared(ctx.body, ctx.headers)) {
          throw new APIError("BAD_REQUEST", { message: copy.ageGateRefused, code: "AGE_GATE_REQUIRED" });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({ data: { ...user, email: user.email.toLowerCase(), age_gate_ok: true } }),
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_S,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url, token }) => opts.sendMagicLink({ email, url, token }),
      }),
      ...(opts.plugins ?? []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

async function sendWithResend({ email, url }: { email: string; url: string }): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set");
    console.log(`[auth] magic link for ${email}: ${url}`);
    return;
  }
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: env.RESEND_FROM, to: email, subject: copy.mailSubject, text: copy.mailBody(url) });
  if (error) throw new Error(`resend: ${error.message}`);
}

let cached: Auth | undefined;

/** The app's auth instance. Throws (clearly) when DATABASE_URL is unset. */
export function getAuth(): Auth {
  if (cached) return cached;
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for auth");
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for auth");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { nextCookies } = require("better-auth/next-js") as typeof import("better-auth/next-js");
  cached = createAuth({
    db,
    secret,
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    sendMagicLink: sendWithResend,
    plugins: [nextCookies()],
  });
  return cached;
}
