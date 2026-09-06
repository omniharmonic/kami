/**
 * POST /api/treasury/propose, as a function: validate → build → propose with
 * the entity's proposer key → record → notify (architecture §7.3). The only
 * signature produced here is the proposer's; execution is the poller's job
 * once two guardians have signed.
 */
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { proposeUsdcPayout } from "@/lib/signing/proposer";
import { validatePayoutProposal, type Refusal } from "@/lib/signing/validate";
import { treasuryCopy } from "./copy";
import type { TreasuryDeps } from "./deps";
import { emailsForRole } from "./notify";

export type ProposeResult =
  | { ok: true; safe_tx_hash: string; status: "proposed"; nonce: number; amount_usdc: string; to: string; entity: string }
  | Refusal;

export function proposalUrl(env: TreasuryDeps["env"], safeTxHash: string): string {
  const base = (env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/guardian/proposals/${safeTxHash}`;
}

export async function proposePayout(
  db: Db,
  deps: TreasuryDeps,
  input: { slug: string; submissionId: string; actor?: string },
): Promise<ProposeResult> {
  const v = await validatePayoutProposal(db, input, { now: deps.now() });
  if (!v.ok) return v;

  const proposed = await proposeUsdcPayout(deps, {
    slug: v.entity.slug,
    safeAddress: v.entity.safeAddress,
    recipient: v.recipient.address,
    amountUsdc6: v.amountUsdc6,
  });

  await db.transaction(async (tx) => {
    await tx.insert(schema.safeProposals).values({
      safeTxHash: proposed.safeTxHash,
      entityId: v.entity.id,
      submissionId: v.submission.id,
      nonce: proposed.nonce,
      toAddress: v.recipient.address,
      amountUsdc: v.amountUsdc,
      proposedAt: deps.now(),
      confirmations: 0,
      status: "pending",
    });
    await appendEntityEvent(tx, {
      entity_id: v.entity.id,
      actor: input.actor ?? `proposer:${v.entity.slug}`,
      kind: "treasury.proposed",
      payload: {
        safe_tx_hash: proposed.safeTxHash,
        submission_id: v.submission.id,
        bounty_id: v.bounty.id,
        nonce: proposed.nonce,
        to: v.recipient.address,
        amount_usdc: v.amountUsdc,
        outcome_uid: v.outcomeUid,
        proposer: proposed.proposer,
      },
      at: deps.now(),
    });
  });

  try {
    const guardians = await emailsForRole(db, v.entity.id, "guardian");
    await deps.notify.send({
      to: guardians,
      subject: treasuryCopy.mail.proposedSubject(v.entity.name, v.amountUsdc),
      text: treasuryCopy.mail.proposedBody(v.entity.name, v.amountUsdc, v.recipient.handle, v.bounty.title, proposalUrl(deps.env, proposed.safeTxHash)),
    });
  } catch (err) {
    deps.log(`guardian notification failed for ${proposed.safeTxHash}: ${(err as Error).message}`);
  }

  return {
    ok: true,
    safe_tx_hash: proposed.safeTxHash,
    status: "proposed",
    nonce: proposed.nonce,
    amount_usdc: v.amountUsdc,
    to: v.recipient.address,
    entity: v.entity.slug,
  };
}
