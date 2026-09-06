/**
 * `POST /api/treasury/propose` — the only way the agent can ask for money to
 * move (ADR-E05, architecture §7.3). Auth is the entity's platform MCP bearer
 * token; the body is `{entity, submission_id}` (the keyless treasury MCP's
 * wire shape). The proposer key signs the SafeTx hash and nothing else: the
 * transaction sits pending until two guardians sign.
 */
import { z } from "zod";
import { getDb } from "@/db/client";
import { json, slugOk } from "@/lib/jobs/common";
import { authorizeMcpFor } from "@/lib/treasury/auth";
import { getTreasuryDeps } from "@/lib/treasury/deps";
import { proposePayout } from "@/lib/treasury/propose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  entity: z.string().min(1),
  submission_id: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { reason: "bad_json" });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json(400, { reason: "bad_request", detail: parsed.error.issues.map((i) => i.path.join(".")) });
  const slug = parsed.data.entity.replace(/^entity\//, "");
  if (!slugOk(slug)) return json(400, { reason: "bad_entity" });

  // the token must be the one for this entity (or the shared secret, for now)
  const auth = await authorizeMcpFor(req, db, slug);
  if (auth instanceof Response) return auth;

  try {
    const out = await proposePayout(db, getTreasuryDeps(), { slug, submissionId: parsed.data.submission_id, actor: "treasury-mcp" });
    if (!out.ok) return json(out.status, { reason: out.code, detail: out.message });
    return json(200, { safe_tx_hash: out.safe_tx_hash, status: out.status, nonce: out.nonce, amount_usdc: out.amount_usdc, to: out.to, entity: out.entity });
  } catch (err) {
    console.error("[treasury/propose]", (err as Error).message);
    return json(502, { reason: "propose_failed", detail: (err as Error).message.slice(0, 200) });
  }
}
