/**
 * The monthly donor report (PRD G6, architecture §7.7, Appendix A.5, plan T2.11).
 *
 * Order, and every step is a refusal point:
 *
 *  1. **Refuse when `config.donor_report_blocked.<slug>` is set.** The nightly
 *     reconciliation sets it when the ledger and the chain disagree. A report
 *     is a promise about numbers; a blocked reconciliation means we do not know
 *     the numbers. Nothing is written, nothing is sent, a steward is paged.
 *  2. Assemble the month from our own rows and one chain read: balance,
 *     inflows by rail, every payout with amount, recipient handle, Safe tx
 *     hash, attestation UID and evidence thumbnails, `as_of`.
 *  3. Turn those numbers into a facts-1.0 fact sheet and ask the entity for
 *     **one paragraph** through the gate. On `X-Guard: held`, on a tunnel
 *     error, or on anything unreadable, the templated paragraph is used
 *     instead and which one was used is recorded. An unguarded number is never
 *     published.
 *  4. Render `public_md` with **no donor identity in it at all**.
 *  5. Insert `donor_reports`, mail every donor of record, and stamp `sent_at`
 *     **only after the mail succeeds**.
 */
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { activeEntities, getConfig, setConfig } from "@/lib/jobs/common";
import type { TreasuryDeps } from "@/lib/treasury/deps";
import { stewardEmails } from "@/lib/treasury/notify";
import { readSafeBalance } from "@/lib/treasury/reads";
import { reportCopy } from "./copy";
import { askEntityForParagraph, type ParagraphResult } from "./gate";

export const REPORT_BLOCKED_PREFIX = "donor_report_blocked.";

// ---------------------------------------------------------------------------
// months
// ---------------------------------------------------------------------------

/** "2026-09-01" — the month a run on `now` reports on (the previous whole month). */
export function previousMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function monthBounds(month: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(month);
  if (!m) throw new TypeError(`bad month ${month} (want YYYY-MM-01)`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1)) };
}

export function monthLabel(month: string): string {
  const { from } = monthBounds(month);
  return from.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function usd(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// ---------------------------------------------------------------------------
// the numbers
// ---------------------------------------------------------------------------

export type InflowLine = { rail: string; count: number; gross_usd: string; fee_usd: string; net_usd: string };

export type PayoutLine = {
  amount: string;
  recipient_handle: string;
  safe_tx_hash: string | null;
  eas_uid: string | null;
  evidence_thumbnails: string[];
  bounty_title: string | null;
  executed_at: string | null;
};

export type ReportData = {
  entity: { id: string; slug: string; name: string; archetype: string; safe_address: string | null; chain_id: number };
  month: string;
  month_label: string;
  balance: { usdc: string | null; as_of: string | null; reason?: string };
  inflows: InflowLine[];
  inflow_totals: { count: number; gross_usd: string; fee_usd: string; net_usd: string };
  payouts: PayoutLine[];
  payout_total_usd: string;
  as_of: string;
};

function thumbUrl(deps: TreasuryDeps, key: string): string | null {
  const base = deps.env.KAMI_EVIDENCE_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key.replace(/^\/+/, "")}`;
}

export async function assembleReport(
  db: Db,
  deps: TreasuryDeps,
  entity: typeof schema.entities.$inferSelect,
  month: string,
): Promise<ReportData> {
  const { from, to } = monthBounds(month);
  const asOf = deps.now();

  const bal = await readSafeBalance(deps, entity.safeAddress);

  const inflowRows = await db
    .select({
      rail: schema.donations.rail,
      count: sql<number>`count(*)::int`,
      gross: sql<string>`coalesce(sum(${schema.donations.gross}), 0)`,
      fee: sql<string>`coalesce(sum(${schema.donations.fee}), 0)`,
      net: sql<string>`coalesce(sum(${schema.donations.net}), 0)`,
    })
    .from(schema.donations)
    .where(and(eq(schema.donations.entityId, entity.id), gte(schema.donations.receivedAt, from), lt(schema.donations.receivedAt, to)))
    .groupBy(schema.donations.rail);

  const inflows: InflowLine[] = inflowRows.map((r) => ({
    rail: r.rail,
    count: r.count,
    gross_usd: usd(r.gross).toFixed(2),
    fee_usd: usd(r.fee).toFixed(2),
    net_usd: usd(r.net).toFixed(2),
  }));
  const inflow_totals = {
    count: inflows.reduce((s, r) => s + r.count, 0),
    gross_usd: inflows.reduce((s, r) => s + Number(r.gross_usd), 0).toFixed(2),
    fee_usd: inflows.reduce((s, r) => s + Number(r.fee_usd), 0).toFixed(2),
    net_usd: inflows.reduce((s, r) => s + Number(r.net_usd), 0).toFixed(2),
  };

  const payoutRows = await db
    .select({ payout: schema.payouts, bounty: schema.bounties, user: schema.users, evaluation: schema.evaluations, submission: schema.submissions })
    .from(schema.payouts)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.payouts.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .leftJoin(schema.users, eq(schema.users.id, schema.payouts.recipientUserId))
    .leftJoin(schema.evaluations, eq(schema.evaluations.submissionId, schema.submissions.id))
    .where(and(eq(schema.bounties.entityId, entity.id), gte(schema.payouts.executedAt, from), lt(schema.payouts.executedAt, to)))
    .orderBy(schema.payouts.executedAt);

  const submissionIds = [...new Set(payoutRows.map((r) => r.submission.id))];
  const files = submissionIds.length
    ? await db
        .select({ submissionId: schema.evidenceFiles.submissionId, key: schema.evidenceFiles.r2Key })
        .from(schema.evidenceFiles)
        .where(inArray(schema.evidenceFiles.submissionId, submissionIds))
    : [];
  const thumbsBySubmission = new Map<string, string[]>();
  for (const f of files) {
    if (!f.submissionId) continue;
    const url = thumbUrl(deps, f.key);
    if (!url) continue;
    const list = thumbsBySubmission.get(f.submissionId) ?? [];
    if (list.length < 4) list.push(url);
    thumbsBySubmission.set(f.submissionId, list);
  }

  const seen = new Set<string>();
  const payouts: PayoutLine[] = [];
  for (const r of payoutRows) {
    if (seen.has(r.payout.id)) continue;
    seen.add(r.payout.id);
    payouts.push({
      amount: usd(r.payout.amountUsdc).toFixed(2),
      recipient_handle: r.user?.name ?? r.user?.email.split("@")[0] ?? "a contributor",
      safe_tx_hash: r.payout.safeTxHash,
      eas_uid: r.payout.easUidCompleted ?? r.evaluation?.easUid ?? null,
      evidence_thumbnails: thumbsBySubmission.get(r.submission.id) ?? [],
      bounty_title: r.bounty.title,
      executed_at: r.payout.executedAt?.toISOString() ?? null,
    });
  }

  return {
    entity: {
      id: entity.id,
      slug: entity.slug,
      name: entity.name,
      archetype: entity.archetype,
      safe_address: entity.safeAddress,
      chain_id: entity.chainId ?? deps.chain.chainId,
    },
    month,
    month_label: monthLabel(month),
    balance:
      bal.balance_usdc === null
        ? { usdc: null, as_of: null, reason: bal.reason }
        : { usdc: bal.balance_usdc, as_of: bal.as_of },
    inflows,
    inflow_totals,
    payouts,
    payout_total_usd: payouts.reduce((s, p) => s + Number(p.amount), 0).toFixed(2),
    as_of: asOf.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// the fact sheet and the paragraph
// ---------------------------------------------------------------------------

export type FactSheet = { schema_version: "1.0"; as_of: string; source_tool: string; atoms: Array<Record<string, unknown>> };

/** facts-1.0 (`packages/facts-schema/facts-1.0.json`) built from the report's own numbers. */
export function buildFactSheet(data: ReportData): FactSheet {
  const atoms: Array<Record<string, unknown>> = [];
  if (data.balance.usdc !== null) {
    atoms.push({ kind: "number", value: Number(data.balance.usdc), unit: "USD", property: "safe_balance_usdc", time: data.balance.as_of, stale: false, label: "Safe balance" });
  }
  atoms.push({ kind: "number", value: Number(data.inflow_totals.net_usd), unit: "USD", property: "donations_net_usd", time: data.as_of, stale: false, label: "donations received, net of fees" });
  atoms.push({ kind: "number", value: Number(data.inflow_totals.gross_usd), unit: "USD", property: "donations_gross_usd", time: data.as_of, stale: false, label: "donations received, gross" });
  atoms.push({ kind: "number", value: data.inflow_totals.count, property: "donation_count", time: data.as_of, stale: false, label: "donations" });
  atoms.push({ kind: "number", value: Number(data.payout_total_usd), unit: "USD", property: "payouts_usdc", time: data.as_of, stale: false, label: "paid out" });
  atoms.push({ kind: "number", value: data.payouts.length, property: "payout_count", time: data.as_of, stale: false, label: "payouts" });
  for (const p of data.payouts) {
    atoms.push({ kind: "number", value: Number(p.amount), unit: "USD", property: "payout_usdc", time: p.executed_at, stale: false, label: p.bounty_title ?? "payout" });
  }
  atoms.push({ kind: "time", value: data.as_of, role: "as_of" });
  return { schema_version: "1.0", as_of: data.as_of, source_tool: "kami.donor_report", atoms };
}

/** The paragraph used whenever the guard holds or the tunnel is down. Only our own numbers. */
export function templateParagraph(data: ReportData): string {
  return reportCopy.templateParagraph(data);
}

// ---------------------------------------------------------------------------
// public markdown
// ---------------------------------------------------------------------------

/**
 * The public half. Donor identity never appears: inflows are aggregated by
 * rail, and nothing here reads `donations.donor_user_id`.
 */
export function renderPublicMd(data: ReportData, paragraph: string, paragraphSource: "entity" | "template"): string {
  const l: string[] = [];
  l.push(`# ${data.entity.name} — ${data.month_label}`);
  l.push("");
  l.push(paragraph.trim());
  l.push("");
  l.push(paragraphSource === "entity" ? reportCopy.guardedNote : reportCopy.templatedNote);
  l.push("");
  l.push(`## ${reportCopy.balanceHeading}`);
  l.push(
    data.balance.usdc === null
      ? reportCopy.balanceUnknown
      : `${data.balance.usdc} USDC in the Safe${data.balance.as_of ? `, read at ${data.balance.as_of}` : ""}.`,
  );
  l.push("");
  l.push(`## ${reportCopy.inflowsHeading}`);
  if (data.inflows.length === 0) {
    l.push(reportCopy.inflowsNone);
  } else {
    l.push("| rail | donations | gross | fees | net |");
    l.push("|---|---:|---:|---:|---:|");
    for (const i of data.inflows) l.push(`| ${reportCopy.railLabel[i.rail] ?? i.rail} | ${i.count} | $${i.gross_usd} | $${i.fee_usd} | $${i.net_usd} |`);
    l.push(`| **total** | **${data.inflow_totals.count}** | **$${data.inflow_totals.gross_usd}** | **$${data.inflow_totals.fee_usd}** | **$${data.inflow_totals.net_usd}** |`);
    l.push("");
    l.push(reportCopy.inflowsPrivacy);
  }
  l.push("");
  l.push(`## ${reportCopy.payoutsHeading}`);
  if (data.payouts.length === 0) {
    l.push(reportCopy.payoutsNone);
  } else {
    for (const p of data.payouts) {
      l.push(`- **$${p.amount} USDC** to ${p.recipient_handle}${p.bounty_title ? ` — ${p.bounty_title}` : ""}`);
      l.push(`  - transaction: \`${p.safe_tx_hash ?? "pending"}\``);
      l.push(`  - attestation: \`${p.eas_uid ?? "pending"}\``);
      if (p.evidence_thumbnails.length) l.push(`  - evidence: ${p.evidence_thumbnails.map((u, i) => `[photo ${i + 1}](${u})`).join(", ")}`);
    }
    l.push("");
    l.push(`Total paid out: **$${data.payout_total_usd} USDC**. ${reportCopy.humanSigns}`);
  }
  l.push("");
  l.push(`_${reportCopy.asOf(data.as_of)}_`);
  l.push("");
  l.push(`_${reportCopy.noToken}_`);
  return l.join("\n");
}

// ---------------------------------------------------------------------------
// donors of record
// ---------------------------------------------------------------------------

export type DonorLine = { user_id: string; email: string; count: number; gross_usd: string; net_usd: string };

/** Everyone who gave to this entity in this month and whom we can identify. */
export async function donorsOfRecord(db: Db, entityId: string, month: string): Promise<DonorLine[]> {
  const { from, to } = monthBounds(month);
  const rows = await db
    .select({
      userId: schema.donations.donorUserId,
      email: schema.users.email,
      count: sql<number>`count(*)::int`,
      gross: sql<string>`coalesce(sum(${schema.donations.gross}), 0)`,
      net: sql<string>`coalesce(sum(${schema.donations.net}), 0)`,
    })
    .from(schema.donations)
    .innerJoin(schema.users, eq(schema.users.id, schema.donations.donorUserId))
    .where(
      and(
        eq(schema.donations.entityId, entityId),
        isNotNull(schema.donations.donorUserId),
        gte(schema.donations.receivedAt, from),
        lt(schema.donations.receivedAt, to),
      ),
    )
    .groupBy(schema.donations.donorUserId, schema.users.email);
  return rows
    .filter((r): r is typeof r & { userId: string } => Boolean(r.userId))
    .map((r) => ({ user_id: r.userId, email: r.email, count: r.count, gross_usd: usd(r.gross).toFixed(2), net_usd: usd(r.net).toFixed(2) }));
}

export type Coverage = { donors_total: number; donors_notified: number; pct: number };

/** G6, measured: `donor_reports.donors_notified` over donors of record. */
export async function coverage(db: Db, entityId: string, month: string): Promise<Coverage> {
  const total = (await donorsOfRecord(db, entityId, month)).length;
  const [row] = await db
    .select({ notified: schema.donorReports.donorsNotified, stored: schema.donorReports.donorsTotal })
    .from(schema.donorReports)
    .where(and(eq(schema.donorReports.entityId, entityId), eq(schema.donorReports.month, month)))
    .limit(1);
  const notified = row?.notified ?? 0;
  const donorsTotal = row?.stored ?? total;
  return { donors_total: donorsTotal, donors_notified: notified, pct: donorsTotal === 0 ? 100 : Math.round((notified / donorsTotal) * 1000) / 10 };
}

// ---------------------------------------------------------------------------
// the job
// ---------------------------------------------------------------------------

export type ReportRefusal = {
  ok: false;
  code: "reconciliation_blocked" | "entity_retired" | "already_sent" | "mail_failed";
  entity: string;
  month: string;
  message: string;
  detail?: unknown;
};

export type ReportSuccess = {
  ok: true;
  entity: string;
  month: string;
  report_id: string;
  paragraph_source: "entity" | "template";
  guard: ParagraphResult["guard"];
  coverage: Coverage;
  sent_at: string;
};

export type ReportResult = ReportSuccess | ReportRefusal;

export async function isBlocked(db: Db, slug: string): Promise<boolean> {
  return (await getConfig<boolean>(db, `${REPORT_BLOCKED_PREFIX}${slug}`)) === true;
}

export function reportId(entityId: string, month: string): string {
  return `rep_${entityId.replace(/[^a-z0-9]/gi, "").slice(0, 24)}_${month}`;
}

/**
 * One entity, one month. Refuses (writes nothing) when reconciliation is blocked.
 */
export async function sendDonorReport(
  db: Db,
  deps: TreasuryDeps,
  entity: typeof schema.entities.$inferSelect,
  month: string,
  opts: { force?: boolean; gatewayUrl?: string } = {},
): Promise<ReportResult> {
  if (await isBlocked(db, entity.slug)) {
    await setConfig(
      db,
      `alerts.donor_report_blocked.${entity.slug}`,
      { at: deps.now().toISOString(), month, reason: "reconciliation not clean" },
      deps.now(),
    );
    try {
      const to = await stewardEmails(db, entity.id);
      await deps.notify.send({ to, subject: reportCopy.mail.blockedSubject(entity.name, monthLabel(month)), text: reportCopy.mail.blockedBody(entity.name, monthLabel(month)) });
    } catch (err) {
      deps.log(`steward page failed for blocked report ${entity.slug}: ${(err as Error).message}`);
    }
    deps.log(`donor report for ${entity.slug} ${month} REFUSED: reconciliation is blocked`);
    return {
      ok: false,
      code: "reconciliation_blocked",
      entity: entity.slug,
      month,
      message: reportCopy.blockedRefusal(entity.name),
    };
  }

  const [existing] = await db
    .select()
    .from(schema.donorReports)
    .where(and(eq(schema.donorReports.entityId, entity.id), eq(schema.donorReports.month, month)))
    .limit(1);
  if (existing?.sentAt && !opts.force) {
    return { ok: false, code: "already_sent", entity: entity.slug, month, message: `The ${monthLabel(month)} report for ${entity.name} went out on ${existing.sentAt.toISOString()}.` };
  }

  const data = await assembleReport(db, deps, entity, month);
  const sheet = buildFactSheet(data);
  const paragraph = await askEntityForParagraph(deps, { slug: entity.slug, name: entity.name, month, factSheet: sheet, data }, opts.gatewayUrl);
  const publicMd = renderPublicMd(data, paragraph.text, paragraph.source);

  const id = existing?.id ?? reportId(entity.id, month);
  const donors = await donorsOfRecord(db, entity.id, month);
  const stored = {
    ...data,
    paragraph_source: paragraph.source,
    guard: paragraph.guard,
    donors_of_record: donors.length,
    fact_sheet: sheet,
  };

  if (existing) {
    await db
      .update(schema.donorReports)
      .set({ data: stored, narrativeMd: paragraph.text, guardResult: paragraph.guard, publicMd, donorsTotal: donors.length, donorsNotified: 0, sentAt: null })
      .where(eq(schema.donorReports.id, existing.id));
  } else {
    await db.insert(schema.donorReports).values({
      id,
      entityId: entity.id,
      month,
      data: stored,
      narrativeMd: paragraph.text,
      guardResult: paragraph.guard,
      publicMd,
      donorsTotal: donors.length,
      donorsNotified: 0,
      // sent_at stays null until the mail actually goes out
      sentAt: null,
    });
  }
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: "donor-report",
    kind: "donor_report.assembled",
    payload: { report_id: id, month, paragraph_source: paragraph.source, guard: paragraph.guard, donors_of_record: donors.length, payouts: data.payouts.length, balance_usdc: data.balance.usdc },
    at: deps.now(),
  });

  let notified = 0;
  const failures: Array<{ user_id: string; error: string }> = [];
  for (const d of donors) {
    try {
      await deps.notify.send({
        to: [d.email],
        subject: reportCopy.mail.donorSubject(entity.name, data.month_label),
        text: reportCopy.mail.donorBody(entity.name, data, d, paragraph.text, paragraph.source),
      });
      notified += 1;
    } catch (err) {
      failures.push({ user_id: d.user_id, error: (err as Error).message.slice(0, 160) });
    }
  }

  if (failures.length > 0) {
    await db.update(schema.donorReports).set({ donorsNotified: notified }).where(eq(schema.donorReports.id, id));
    await appendEntityEvent(db, {
      entity_id: entity.id,
      actor: "donor-report",
      kind: "donor_report.mail_failed",
      payload: { report_id: id, month, notified, failed: failures.length, first_error: failures[0]?.error ?? null },
      at: deps.now(),
    });
    deps.log(`donor report ${entity.slug} ${month}: ${failures.length} of ${donors.length} mails failed; sent_at stays null`);
    return { ok: false, code: "mail_failed", entity: entity.slug, month, message: `${failures.length} of ${donors.length} donor emails failed; the report is not marked sent.`, detail: failures };
  }

  const sentAt = deps.now();
  await db.update(schema.donorReports).set({ sentAt, donorsNotified: notified }).where(eq(schema.donorReports.id, id));
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: "donor-report",
    kind: "donor_report.sent",
    payload: { report_id: id, month, donors_total: donors.length, donors_notified: notified, paragraph_source: paragraph.source },
    at: sentAt,
  });
  deps.log(`donor report ${entity.slug} ${month} sent to ${notified}/${donors.length} donors (${paragraph.source} paragraph)`);
  return {
    ok: true,
    entity: entity.slug,
    month,
    report_id: id,
    paragraph_source: paragraph.source,
    guard: paragraph.guard,
    coverage: await coverage(db, entity.id, month),
    sent_at: sentAt.toISOString(),
  };
}

export async function runDonorReports(
  db: Db,
  deps: TreasuryDeps,
  opts: { slug?: string; month?: string; force?: boolean; gatewayUrl?: string } = {},
): Promise<ReportResult[]> {
  const month = opts.month ?? previousMonth(deps.now());
  const entities = await activeEntities(db, opts.slug);
  const out: ReportResult[] = [];
  for (const e of entities) out.push(await sendDonorReport(db, deps, e, month, { force: opts.force ?? false, ...(opts.gatewayUrl ? { gatewayUrl: opts.gatewayUrl } : {}) }));
  return out;
}
