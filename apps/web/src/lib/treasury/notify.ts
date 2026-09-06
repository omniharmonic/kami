/**
 * Guardian / recipient / steward notifications. Resend when a key is set,
 * otherwise one log line per message (the same fallback the magic link uses).
 * Recipients are looked up from `entity_roles` + `users`; nothing here ever
 * embeds a secret in a mail body.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";

export type Mail = { to: string[]; subject: string; text: string };

export interface Notifier {
  send(mail: Mail): Promise<{ delivered: boolean; via: "resend" | "log" | "fake" }>;
}

export function logNotifier(log: (line: string) => void = (l) => console.log(l)): Notifier {
  return {
    async send(mail) {
      if (mail.to.length === 0) return { delivered: false, via: "log" };
      log(`[notify] to=${mail.to.join(",")} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
      return { delivered: false, via: "log" };
    },
  };
}

export function resendNotifier(apiKey: string, from: string): Notifier {
  return {
    async send(mail) {
      if (mail.to.length === 0) return { delivered: false, via: "resend" };
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const r = await resend.emails.send({ from, to: mail.to, subject: mail.subject, text: mail.text });
      if (r.error) throw new Error(`resend: ${r.error.message}`);
      return { delivered: true, via: "resend" };
    },
  };
}

/** Test helper: collects mail. */
export function fakeNotifier(): Notifier & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    async send(mail) {
      sent.push(mail);
      return { delivered: true, via: "fake" };
    },
  };
}

export async function emailsForRole(db: DbOrTx, entityId: string, role: "guardian" | "steward" | "evaluator"): Promise<string[]> {
  const rows = await db
    .select({ email: schema.users.email })
    .from(schema.entityRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.entityRoles.userId))
    .where(
      and(
        eq(schema.entityRoles.entityId, entityId),
        eq(schema.entityRoles.role, role),
        isNotNull(schema.entityRoles.acceptedAt),
        isNull(schema.entityRoles.revokedAt),
      ),
    );
  return [...new Set(rows.map((r) => r.email))];
}

export async function emailForUser(db: DbOrTx, userId: string): Promise<string | null> {
  const [u] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return u?.email ?? null;
}

/** Stewards first; platform admins when an entity has no steward yet. */
export async function stewardEmails(db: DbOrTx, entityId: string): Promise<string[]> {
  const stewards = await emailsForRole(db, entityId, "steward");
  if (stewards.length) return stewards;
  const admins = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.platformAdmin, true));
  return admins.map((a) => a.email);
}
