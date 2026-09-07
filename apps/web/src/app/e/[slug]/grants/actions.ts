"use server";
import { grantsBackendCopy as c } from "@/copy/grants";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { getSession } from "@/lib/session";
import { entityBySlug, slugOk } from "@/lib/jobs/common";
import { createGrantRound, setGrantRoundStatus, applyToGrantRound, GrantError } from "@/lib/grants";
import { GovernanceError } from "@/lib/governance/errors";
export async function grantAction(_prev: {
    ok: boolean;
    message: string;
}, form: FormData): Promise<{
    ok: boolean;
    message: string;
}> {
    const session = await getSession();
    const db = getDb();
    const slug = String(form.get("slug") ?? "");
    if (!session || !db || !slugOk(slug))
        return { ok: false, message: c.signIn };
    const entity = await entityBySlug(db, slug);
    if (!entity)
        return { ok: false, message: c.notFound };
    const input = { entityId: entity.id, userId: session.user.id };
    try {
        const operation = String(form.get("operation") ?? "");
        if (operation === "create") {
            const deadline = String(form.get("applicationDeadline") ?? "");
            const utc = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(deadline) ? `${deadline}:00Z` : deadline;
            await createGrantRound(db, { ...input, title: String(form.get("title") ?? ""), purposeMd: String(form.get("purposeMd") ?? ""), budgetUsdc: String(form.get("budgetUsdc") ?? ""), applicationDeadline: utc });
        }
        else if (operation === "open" || operation === "close")
            await setGrantRoundStatus(db, { ...input, roundId: String(form.get("roundId") ?? ""), status: operation === "open" ? "open" : "closed" });
        else if (operation === "apply")
            await applyToGrantRound(db, { ...input, roundId: String(form.get("roundId") ?? ""), proposalId: String(form.get("proposalId") ?? "") });
        else
            return { ok: false, message: c.unknown };
        revalidatePath(`/e/${slug}/grants`);
        revalidatePath(`/e/${slug}`);
        return { ok: true, message: operation === "apply" ? c.applied : c.updated };
    }
    catch (error) {
        return { ok: false, message: error instanceof GrantError ? error.message : error instanceof GovernanceError ? c.role : c.failed };
    }
}
