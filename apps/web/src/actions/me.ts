"use server";

/**
 * `/me` data controls (PRD §13 #7): delete my chat sessions, the
 * contribute-to-training opt-in, and an evidence-deletion request that keeps
 * the hash. Also assembles the JSON export the page renders.
 */
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getConfigValue, setConfigValue } from "@/lib/governance/config";
import { CONTRIBUTE_OPT_IN_KEY } from "@/lib/governance/me";
import { requestEvidenceDeletion } from "@/lib/governance/submissions";
import { actionRedirect, dbOrThrow, formBool, formString, requireUserOrThrow } from "./util";

export async function deleteMyChatsAction(): Promise<never> {
  return actionRedirect("/me", "chats_deleted", async () => {
    const user = await requireUserOrThrow();
    const db = dbOrThrow();
    const sessions = await db.select({ id: schema.chatSessions.id }).from(schema.chatSessions).where(eq(schema.chatSessions.userId, user.id));
    const ids = sessions.map((s) => s.id);
    if (ids.length) {
      await db.delete(schema.chatMessages).where(inArray(schema.chatMessages.sessionId, ids));
      await db.delete(schema.chatSessions).where(inArray(schema.chatSessions.id, ids));
    }
    revalidatePath("/me");
  });
}

export async function setContributeOptInAction(fd: FormData): Promise<never> {
  return actionRedirect("/me", "saved", async () => {
    const user = await requireUserOrThrow();
    const db = dbOrThrow();
    const on = formBool(fd, "contribute_opt_in");
    const map = await getConfigValue<Record<string, boolean>>(db, CONTRIBUTE_OPT_IN_KEY, {});
    map[user.id] = on;
    await setConfigValue(db, CONTRIBUTE_OPT_IN_KEY, map);
    // Existing sessions follow the new preference; future ones read it at creation.
    await db.update(schema.chatSessions).set({ contributeOptIn: on }).where(eq(schema.chatSessions.userId, user.id));
    revalidatePath("/me");
  });
}

export async function requestEvidenceDeletionAction(fd: FormData): Promise<never> {
  return actionRedirect("/me", "evidence_deletion", async () => {
    const user = await requireUserOrThrow();
    const ids = formString(fd, "file_ids");
    await requestEvidenceDeletion(dbOrThrow(), user.id, ids ? { file_ids: ids.split(",").map((s) => s.trim()).filter(Boolean) } : {});
    revalidatePath("/me");
  });
}

