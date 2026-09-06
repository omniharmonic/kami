"use server";

/**
 * `/admin` mutations (T1.12): the per-entity consultation flag (PRD §13 #4 —
 * a page stays unpublished until consultation is marked done) and the two
 * `config` fields the operators edit.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { setConfigValue } from "@/lib/governance/config";
import { GovernanceError } from "@/lib/governance/errors";
import { requireAdmin } from "@/lib/session";
import { actionRedirect, dbOrThrow, formString } from "./util";

export async function toggleConsultationAction(fd: FormData): Promise<never> {
  return actionRedirect("/admin", "saved", async () => {
    const admin = await requireAdmin();
    const db = dbOrThrow();
    const entityId = formString(fd, "entity_id");
    const [e] = await db.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
    if (!e) throw new GovernanceError("not_found");
    const now = new Date();
    const next = e.consultationDoneAt ? null : now;
    await db.update(schema.entities).set({ consultationDoneAt: next }).where(eq(schema.entities.id, entityId));
    await appendEntityEvent(db, {
      entity_id: entityId,
      actor: admin.id,
      kind: next ? "consultation_marked_done" : "consultation_unmarked",
      payload: { consultation_done_at: next?.toISOString() ?? null },
      at: now,
    });
    revalidatePath("/admin");
    revalidatePath("/");
  });
}

export async function setConfigFieldAction(fd: FormData): Promise<never> {
  return actionRedirect("/admin", "saved", async () => {
    await requireAdmin();
    const db = dbOrThrow();
    const key = formString(fd, "key");
    if (!["sb243_report_due", "card_hour_cost", "reminder_every_turns", "bounty_approvals_required", "per_person_monthly_cap_usdc", "passport_gate_usd", "passport_min", "retro_pct", "audit_rate"].includes(key)) {
      throw new GovernanceError("forbidden", "not an editable config key");
    }
    const raw = formString(fd, "value");
    const value: unknown = raw === "" ? null : Number.isFinite(Number(raw)) && !/^\d{4}-\d{2}-\d{2}$/.test(raw) ? Number(raw) : raw;
    await setConfigValue(db, key, value);
    revalidatePath("/admin");
  });
}
