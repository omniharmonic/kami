"use server";

/**
 * Minting and rotating, as server actions.
 *
 * Both are the same call — `mintEntityToken` overwrites the stored hash — so
 * the difference between "mint" and "rotate" is entirely about consequence, and
 * that difference is enforced here rather than in the component: a rotation
 * that arrives without the confirmation checkbox is refused. A client that
 * skips the warning still cannot skip the confirmation.
 *
 * The plaintext token is returned to the caller and to nowhere else. It is not
 * written to a cookie, not put in a URL, and not logged. The database keeps a
 * sha256, so this reply is the only place it will ever exist outside the
 * agent's environment.
 */
import { sensingCopy as c } from "@/copy/sensing";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { entityBySlug, slugOk } from "@/lib/jobs/common";
import { connectAccess } from "@/lib/connect/access";
import { mintConnectToken, tokenState } from "@/lib/connect/token";
import { getSession } from "@/lib/session";
import type { MintFormState } from "@/components/connect/TokenPanel";

export async function mintConnectTokenAction(_prev: MintFormState, formData: FormData): Promise<MintFormState> {
  const slug = String(formData.get("slug") ?? "");
  if (!slugOk(slug)) return { ok: false, error: "not_found" };

  const db = getDb();
  if (!db) return { ok: false, error: "no_db" };

  const entity = await entityBySlug(db, slug);
  if (!entity) return { ok: false, error: "not_found" };

  const session = await getSession();
  const access = await connectAccess({ id: entity.id, created_by: entity.createdBy }, session?.user ?? null);
  if (!access.may_mint) return { ok: false, error: "forbidden" };

  // Rotation is destructive to a running agent, so it needs the box ticked.
  const before = await tokenState(db, slug);
  if (before.exists && formData.get("confirm") !== "yes") return { ok: false, error: "confirm_required" };

  const outcome = await mintConnectToken(db, { id: entity.id, slug: entity.slug }, session?.user.id ?? null);
  revalidatePath(`/e/${slug}/connect`);
  return { ok: true, token: outcome.token, replaced: outcome.replaced };
}

export async function sensingAction(_prev: {message:string;ok:boolean;warnings?:string[];warningHash?:string},formData:FormData):Promise<{message:string;ok:boolean;warnings?:string[];warningHash?:string}>{
 const {approveSensing,refreshSensing,SensingError,SensingWarnings}=await import("@/lib/connect/sensing");
 const slug=String(formData.get("slug")??"");const db=getDb();const session=await getSession();
 if(!db || !session || !slugOk(slug))return {ok:false,message:c.signIn};
 try{
  if(formData.get("operation")==="approve"){
   if(formData.get("reviewed")!=="yes")return {ok:false,message:c.checkboxRequired};
   await approveSensing(db,{slug,userId:session.user.id,version:Number(formData.get("version")),hash:String(formData.get("hash")??""),acceptedWarningHash:formData.get("warnings_reviewed")==="yes"?String(formData.get("warning_hash")??""):undefined});
  }else if(formData.get("operation")==="refresh"){
   await refreshSensing(db,{slug,userId:session.user.id});
  }else return {ok:false,message:c.unknownAction};
  revalidatePath(`/e/${slug}/connect`);revalidatePath(`/e/${slug}`);
  return {ok:true,message:formData.get("operation")==="approve"?c.approved:c.refreshed};
 }catch(error){if(error instanceof SensingWarnings)return {ok:false,message:error.message,warnings:error.warnings,warningHash:error.warningHash};return {ok:false,message:error instanceof SensingError?error.message:c.failed};}
}

/** Existing beings need no summon draft or platform-admin role to publish. */
export async function publishConnectEntityAction(_previous: { ok: boolean; message: string }, form: FormData): Promise<{ ok: boolean; message: string }> {
  const session = await getSession();
  const db = getDb();
  const slug = String(form.get("slug") ?? "");
  if (!session || !db || !slugOk(slug)) return { ok: false, message: "Sign in as this being’s steward to publish it." };
  try {
    const entity = await entityBySlug(db, slug);
    if (!entity) return { ok: false, message: "Being not found." };
    const { publishEntity } = await import("@/lib/summon/draft");
    // This is the authority: accepted steward/admin, including any Hat check.
    await publishEntity(db, entity.id, session.user.id);
    revalidatePath(`/e/${slug}/connect`); revalidatePath(`/e/${slug}`); revalidatePath("/");
    return { ok: true, message: "This being’s page is now public. Its consultation record and agent pause are unchanged." };
  } catch {
    return { ok: false, message: "Publication was not completed. An accepted steward or administrator is required, and the being must not be retired." };
  }
}
