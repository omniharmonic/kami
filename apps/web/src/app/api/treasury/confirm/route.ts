/**
 * `POST /api/treasury/confirm` — a guardian's EIP-712 signature over the
 * SafeTx hash, forwarded to the Transaction Service (`confirmTransaction`).
 * Session auth + the guardian role; the platform never signs on their behalf.
 */
import { z } from "zod";
import { getDb } from "@/db/client";
import { json } from "@/lib/jobs/common";
import { AuthError, getSession, hasRole } from "@/lib/session";
import { confirmProposal } from "@/lib/treasury/confirm";
import { getTreasuryDeps } from "@/lib/treasury/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  safe_tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

export async function POST(req: Request): Promise<Response> {
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  let user;
  try {
    const s = await getSession();
    if (!s) return json(401, { reason: "unauthenticated" });
    user = s.user;
  } catch (err) {
    if (err instanceof AuthError) return json(err.status, { reason: "unauthenticated" });
    throw err;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { reason: "bad_json" });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json(400, { reason: "bad_request" });

  const out = await confirmProposal(db, getTreasuryDeps(), {
    safeTxHash: parsed.data.safe_tx_hash,
    signature: parsed.data.signature,
    userId: user.id,
    isGuardian: async (entityId) => user.platform_admin || (await hasRole(user.id, entityId, "guardian")),
  });
  if (!out.ok) return json(out.status, { reason: out.code, detail: out.message });
  return json(200, { safe_tx_hash: out.safe_tx_hash, signer: out.signer, confirmations: out.confirmations, required: out.required });
}
