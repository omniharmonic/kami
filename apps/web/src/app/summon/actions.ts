"use server";

/**
 * Summon server actions (architecture §6.2: every authenticated mutation is a
 * server action). Each takes a plain `FormData` from a `<form action={…}>`,
 * so every step works with JavaScript switched off, and redirects back with
 * `?ok=` or `?error=<code>`.
 *
 * The hard-rules block is never read from the form. There is no field for it,
 * and `saveSoulAction` renders it from the template on the server: a client
 * that posts one gets `hard_rules_immutable`.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireAdmin, requireUser, AuthError } from "@/lib/session";
import {
  completeSummon,
  createDraft,
  deleteDraft,
  loadDraft,
  markConsultationDone,
  publishEntity,
  saveStep,
  setConsultationNote,
  isSummonError,
  REVIEW_STEP,
  type DraftData,
} from "@/lib/summon/draft";
import { normalizeRiveConfig } from "@/lib/summon/parts";
import { proposeForPlace, ProposalFailed } from "@/lib/summon/propose";
import { VoiceBlockError, validateVoice } from "@/lib/summon/soul";
import { twinFor } from "@/lib/summon/twin";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function codeOf(err: unknown): string {
  if (isSummonError(err)) return err.code;
  if (err instanceof VoiceBlockError) return "voice_invalid";
  if (err instanceof ProposalFailed) return err.code === "twin_unreachable" ? "twin_unreachable" : "binding_invalid";
  if (err instanceof AuthError) return err.status === 401 ? "unauthenticated" : "forbidden";
  console.warn("[summon] unexpected error:", (err as Error)?.message);
  return "generic";
}

function withParam(path: string, key: string, value: string): string {
  const [base, query] = path.split("?");
  const params = new URLSearchParams(query ?? "");
  params.delete("ok");
  params.delete("error");
  params.set(key, value);
  return `${base}?${params.toString()}`;
}

async function run(path: string, ok: string, fn: () => Promise<string | void>): Promise<never> {
  let target: string;
  try {
    const to = await fn();
    target = typeof to === "string" ? to : withParam(path, "ok", ok);
  } catch (err) {
    target = withParam(path, "error", codeOf(err));
  }
  redirect(target);
}

function db() {
  const d = getDb();
  if (!d) throw new Error("no_db");
  return d;
}

const stepPath = (id: string, step: number | string) => `/summon/${id}/${step}`;

// ---------------------------------------------------------------------------

export async function startSummonAction(): Promise<never> {
  return run("/summon", "started", async () => {
    const user = await requireUser();
    const draft = await createDraft(user.id, { db: db() });
    return stepPath(draft.id, 1);
  });
}

export async function deleteDraftAction(fd: FormData): Promise<never> {
  return run("/summon", "deleted", async () => {
    const user = await requireUser();
    await deleteDraft(str(fd, "draft_id"), user.id, { db: db() });
    revalidatePath("/summon");
  });
}

/** Step 1: propose a binding for the chosen place and store the whole proposal. */
export async function choosePlaceAction(fd: FormData): Promise<never> {
  const id = str(fd, "draft_id");
  return run(stepPath(id, 1), "saved", async () => {
    const user = await requireUser();
    const d = db();
    await loadDraft(id, user.id, { db: d });
    const placeId = str(fd, "place_id");
    if (!placeId) throw new ProposalFailed("no_members", "no place was chosen");
    const name = str(fd, "name");
    const slugCandidate = str(fd, "slug");
    // The twin an entity reads is resolved by slug, so a re-proposal for the
    // same slug keeps reading the same tree (T3.8).
    const tree = await twinFor(slugCandidate || "new", { db: d });
    const { place } = await proposeForPlace(
      tree,
      {
        place_id: placeId,
        ...(str(fd, "query") ? { query: str(fd, "query") } : {}),
        ...(str(fd, "gnis_id") ? { gnis_id: str(fd, "gnis_id") } : {}),
        ...(str(fd, "archetype") ? { archetype: str(fd, "archetype") } : {}),
        ...(name ? { name } : {}),
        ...(slugCandidate ? { slug: slugCandidate } : {}),
      },
      { db: d },
    );
    await saveStep(id, 1, { place }, { db: d });
    // Siblings are shown on step 1 after the proposal, before step 2 asks for
    // any effort (§4.4); "continue" is a separate tap.
    return withParam(stepPath(id, 1), "ok", "proposed");
  });
}

export async function savePartsAction(fd: FormData): Promise<never> {
  const id = str(fd, "draft_id");
  return run(stepPath(id, 2), "saved", async () => {
    const user = await requireUser();
    const d = db();
    const draft = await loadDraft(id, user.id, { db: d });
    const archetype = str(fd, "archetype") || draft.data.place?.archetype || "creek";
    const parts: Record<string, string> = {};
    for (const [key, value] of fd.entries()) {
      if (key.startsWith("part_") && typeof value === "string") parts[key.slice("part_".length)] = value;
    }
    const rive_config = normalizeRiveConfig({ archetype, parts, colour: str(fd, "colour") }, archetype, draft.data.parts?.rive_config.unlocked ?? []);
    await saveStep(id, 2, { parts: { rive_config } }, { db: d });
    return stepPath(id, 3);
  });
}

export async function saveSoulAction(fd: FormData): Promise<never> {
  const id = str(fd, "draft_id");
  return run(stepPath(id, 3), "saved", async () => {
    const user = await requireUser();
    const d = db();
    await loadDraft(id, user.id, { db: d });
    // There is no hard-rules field. If one is posted anyway, refuse loudly.
    if (fd.has("hard_rules") || fd.has("hard_rules_md")) {
      const err = new Error("hard rules cannot be sent from the client");
      (err as Error & { name: string }).name = "SummonError";
      (err as unknown as { code: string }).code = "hard_rules_immutable";
      throw err;
    }
    const voice_md = validateVoice(String(fd.get("voice") ?? ""));
    const { loadHardRules } = await import("@/lib/summon/soul");
    const rules = await loadHardRules();
    await saveStep(id, 3, { soul: { voice_md, hard_rules_version: rules.version } }, { db: d });
    return stepPath(id, 4);
  });
}

export async function saveGuardiansAction(fd: FormData): Promise<never> {
  const id = str(fd, "draft_id");
  return run(stepPath(id, 4), "saved", async () => {
    const user = await requireUser();
    const d = db();
    await loadDraft(id, user.id, { db: d });
    const { normalizeGuardianEmails } = await import("@/lib/summon/draft");
    const emails = normalizeGuardianEmails([str(fd, "guardian_1"), str(fd, "guardian_2")], user.email);
    await saveStep(id, 4, { guardians: { emails } }, { db: d });
    return stepPath(id, 5);
  });
}

export async function saveFundAction(fd: FormData): Promise<never> {
  const id = str(fd, "draft_id");
  return run(stepPath(id, 5), "saved", async () => {
    const user = await requireUser();
    const d = db();
    await loadDraft(id, user.id, { db: d });
    const note = str(fd, "note");
    const patch: DraftData = { fund: { skipped: str(fd, "skip") === "1" || note === "", note: note || null } };
    await saveStep(id, 5, patch, { db: d });
    return stepPath(id, "review");
  });
}

export async function saveConsultationAction(fd: FormData): Promise<never> {
  const id = str(fd, "draft_id");
  return run(stepPath(id, "review"), "saved", async () => {
    const user = await requireUser();
    const d = db();
    const draft = await loadDraft(id, user.id, { db: d });
    const md = String(fd.get("consultation") ?? "").trim();
    if (draft.data.completed) {
      await setConsultationNote(d, draft.data.completed.entity_id, md, user.id);
    } else {
      await saveStep(id, REVIEW_STEP, { consultation: { md } }, { db: d });
    }
  });
}

export async function completeSummonAction(fd: FormData): Promise<never> {
  const id = str(fd, "draft_id");
  return run(stepPath(id, "review"), "summoned", async () => {
    const user = await requireUser();
    const d = db();
    await loadDraft(id, user.id, { db: d });
    const result = await completeSummon(id, { db: d });
    revalidatePath("/");
    revalidatePath(`/e/${result.slug}`);
    return stepPath(id, "done");
  });
}

/**
 * Optional consultation recording. This never changes page publication.
 */
export async function markConsultationDoneAction(fd: FormData): Promise<never> {
  const id = str(fd, "draft_id");
  return run(stepPath(id, "done"), "consultation_done", async () => {
    const admin = await requireAdmin();
    const d = db();
    const entityId = str(fd, "entity_id");
    await markConsultationDone(d, entityId, admin.id);
    revalidatePath(`/e/${entityId.replace(/^entity\//, "")}`);
    revalidatePath("/admin");
  });
}

/** Publish the completed being explicitly, without changing consultation. */
export async function publishSummonedEntityAction(fd: FormData): Promise<never> {
  const id = str(fd, "draft_id");
  return run(stepPath(id, "done"), "published", async () => {
    const user = await requireUser();
    const d = db();
    const draft = await loadDraft(id, user.id, { db: d });
    const entityId = draft.data.completed?.entity_id;
    if (!entityId) throw new Error("Complete this summon before publication");
    await publishEntity(d, entityId, user.id);
    revalidatePath("/");
    revalidatePath(`/e/${draft.data.completed!.slug}`);
    revalidatePath("/admin");
  });
}
