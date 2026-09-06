/**
 * `/guardian/proposals/[hash]` — the one screen a guardian sees before signing
 * a payout (architecture §7.3, plan T2.5): bounty, evidence, evaluation,
 * attestation UID, amount, recipient, Safe, nonce, and a Sign button that signs
 * the Safe EIP-712 typed data built server-side. Guardians only (admins pass);
 * Safe{Wallet} is the escape hatch.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { auth as authCopy } from "@/copy";
import { AuthError, getSession, hasRole } from "@/lib/session";
import { getTreasuryDeps } from "@/lib/treasury/deps";
import { treasuryCopy } from "@/lib/treasury/copy";
import { assertGuardian, loadProposalView } from "@/lib/treasury/proposal-page";
import { ProposalDetail } from "@/components/treasury/ProposalDetail";
import { SignProposal } from "@/components/treasury/SignProposal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ hash: string }> };

export const metadata: Metadata = { title: treasuryCopy.page.title, robots: { index: false, follow: false } };

export default async function ProposalPage({ params }: Props) {
  const { hash } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) notFound();
  const db = getDb();
  if (!db) {
    return (
      <section className="section">
        <h1>{treasuryCopy.page.title}</h1>
        <p className="muted">{treasuryCopy.page.notFound}</p>
      </section>
    );
  }
  const view = await loadProposalView(db, getTreasuryDeps(), hash);
  if (!view) notFound();

  const session = await getSession();
  try {
    await assertGuardian(session?.user ?? null, view.entity.id, hasRole);
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 403;
    return (
      <section className="section stack">
        <h1>{treasuryCopy.page.title}</h1>
        <p className="muted">{status === 401 ? treasuryCopy.page.signIn : treasuryCopy.page.forbidden}</p>
        {status === 401 && <Link className="btn tap" href="/sign-in">{authCopy.title}</Link>}
      </section>
    );
  }

  return (
    <section className="section stack">
      <ProposalDetail view={view} />
      <div className="card">
        <SignProposal
          safeTxHash={view.safe_tx_hash}
          typedDataJson={view.typed_data_json}
          confirmations={view.confirmations}
          required={view.required}
          status={view.status}
          safeWalletUrl={view.safe_wallet_url}
        />
      </div>
      <p className="faint" style={{ margin: 0 }}>
        <Link className="tap" href={`/e/${view.entity.slug}`}>{view.entity.name}</Link>
      </p>
    </section>
  );
}
