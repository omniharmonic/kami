"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth as copy } from "@/copy";
import { AGE_GATE_HEADER, getAuth } from "@/lib/auth";

export type SignInState = { ok: boolean; message: string | null; email?: string };

const schema = z.object({ email: z.string().email(), age_gate: z.literal("on") });

/** Server action: refuses without the "I am 13 or older" declaration, then asks Better Auth for a magic link. */
export async function requestMagicLink(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = schema.safeParse({ email: String(formData.get("email") ?? "").trim().toLowerCase(), age_gate: formData.get("age_gate") });
  if (!parsed.success) {
    const ageProblem = parsed.error.issues.some((i) => i.path[0] === "age_gate");
    return { ok: false, message: ageProblem ? copy.ageGateRefused : "Please enter a valid email." };
  }
  try {
    const h = new Headers(await headers());
    h.set(AGE_GATE_HEADER, "confirmed");
    await getAuth().api.signInMagicLink({
      body: { email: parsed.data.email, callbackURL: "/", metadata: { age_gate_ok: true } },
      headers: h,
    });
    return { ok: true, message: copy.sent(parsed.data.email), email: parsed.data.email };
  } catch (err) {
    console.warn("[auth] magic link failed:", (err as Error).message);
    return { ok: false, message: copy.error };
  }
}
