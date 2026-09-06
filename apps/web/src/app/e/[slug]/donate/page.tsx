/**
 * `/e/[slug]/donate` — the donation page (architecture §6.6, PRD §13 #2).
 *
 * A server component: it reads the entity, the fee table, the legal wrapper
 * from `config.legal_entity_name`, and the Safe address, renders the QR
 * server-side, and hands everything to `DonatePanel`. Nothing on this page
 * loads Privy — a donor never needs a wallet (ADR-E07).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DonatePanel } from "@/components/donate/DonatePanel";
import { errors } from "@/copy";
import { withDb } from "@/db/client";
import { donateCopy } from "@/lib/donations/copy";
import { directDonationTarget } from "@/lib/donations/direct";
import { donationsEnv } from "@/lib/donations/env";
import { DEFAULT_MAX_USD, DEFAULT_MIN_USD } from "@/lib/donations/stripe";
import { getEntityBySlug } from "@/lib/entities";
import { requireVisibleEntity } from "@/lib/entity-access";
import { getConfig } from "@/lib/jobs/common";
import { getTreasuryDeps } from "@/lib/treasury/deps";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  if (!entity) return { title: errors.notFound };
  return { title: donateCopy.title(entity.name), description: donateCopy.intro(entity.name) };
}

export default async function DonatePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { entity } = await requireVisibleEntity(slug);
  if (!entity) notFound();

  const deps = getTreasuryDeps();
  const [legalEntityName, minUsd, maxUsd] = await withDb(
    async (db) =>
      [
        (await getConfig<string>(db, "legal_entity_name")) ?? null,
        Number((await getConfig<number>(db, "donation_min_usd")) ?? DEFAULT_MIN_USD),
        Number((await getConfig<number>(db, "donation_max_usd")) ?? DEFAULT_MAX_USD),
      ] as const,
    [null, DEFAULT_MIN_USD, DEFAULT_MAX_USD] as const,
  );

  const target = await directDonationTarget(deps, entity.safe_address);
  const cardEnabled = Boolean(donationsEnv().STRIPE_SECRET_KEY) && !entity.retired;
  const notice = sp.thanks ? ("thanks" as const) : sp.cancelled ? ("cancelled" as const) : null;

  return (
    <>
      <DonatePanel
        name={entity.name}
        slug={entity.slug}
        legalEntityName={legalEntityName}
        minUsd={minUsd}
        maxUsd={maxUsd}
        cardEnabled={cardEnabled}
        notice={notice}
        direct={{
          safeAddress: target.safe_address,
          chainName: target.chain_name,
          chainId: target.chain_id,
          tokenAddress: target.token.address,
          qrDataUrl: target.qr_data_url,
        }}
      />
      <p className="section">
        <Link href={`/e/${entity.slug}`} className="btn tap">
          {`Back to ${entity.name}`}
        </Link>
      </p>
    </>
  );
}
