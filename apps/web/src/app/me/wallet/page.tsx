/**
 * `/me/wallet` — one of the three surfaces where Privy is allowed to load
 * (ADR-E07, architecture §6.5). The provider is behind `next/dynamic` with
 * `ssr: false`, so it is a separate client chunk that no other route pulls in.
 *
 * The page itself is a server component: it reads the stored address, the
 * off-ramp link from `config.offramp_url`, and the person's tax position, and
 * never sees a key.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { WalletProvider } from "@/lib/privy/client";
import { CreateWallet } from "@/components/wallet/CreateWallet";
import { WalletPanel } from "@/components/wallet/WalletPanel";
import { walletCopy } from "@/components/wallet/copy";
import { auth as authCopy } from "@/copy";
import { withDb } from "@/db/client";
import * as schema from "@/db/schema";
import { offrampUrl, privyEnv } from "@/lib/privy";
import { getConfig } from "@/lib/jobs/common";
import { getSession } from "@/lib/session";
import { taxStatusFor, type TaxStatus } from "@/lib/tax/forms";
import { getTreasuryDeps } from "@/lib/treasury/deps";
import { forgetWallet, linkWallet } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: walletCopy.title, robots: { index: false } };

export default async function WalletPage() {
  const session = await getSession();
  if (!session) {
    return (
      <section className="section">
        <h1>{walletCopy.title}</h1>
        <p>{walletCopy.signIn}</p>
        <p>
          <Link href="/sign-in" className="btn tap">{authCopy.title}</Link>
        </p>
      </section>
    );
  }

  const env = privyEnv();
  const deps = getTreasuryDeps();
  type WalletPageData = { address: string | null; configuredOfframp: string | null; appIdFromConfig: string | null; tax: TaxStatus | null };
  const data = await withDb<WalletPageData>(
    async (db) => {
      const [u] = await db.select({ address: schema.users.walletAddress }).from(schema.users).where(eq(schema.users.id, session.user.id)).limit(1);
      const configuredOfframp = (await getConfig<string>(db, "offramp_url")) ?? null;
      const appIdFromConfig = (await getConfig<string>(db, "privy_app_id")) ?? null;
      const tax = await taxStatusFor(db, session.user.id);
      return { address: u?.address ?? null, configuredOfframp, appIdFromConfig, tax };
    },
    { address: null, configuredOfframp: null, appIdFromConfig: null, tax: null },
  );

  const appId = data.appIdFromConfig ?? env.PRIVY_APP_ID ?? null;
  const panel = (
    <WalletPanel
      address={data.address}
      chainName={deps.chain.name}
      chainId={deps.chain.chainId}
      offrampUrl={offrampUrl(data.configuredOfframp, env)}
      createSlot={appId ? <CreateWallet link={linkWallet} /> : null}
      tax={
        data.tax
          ? { cumulative_usd: data.tax.cumulative_usd, threshold_usd: data.tax.threshold_usd, collected: Boolean(data.tax.collected_at), collector: data.tax.collector }
          : null
      }
      disconnect={forgetWallet}
    />
  );

  return <WalletProvider appId={appId}>{panel}</WalletProvider>;
}
