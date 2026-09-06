import type { Metadata } from "next";
import Link from "next/link";
import { setConfigFieldAction, toggleConsultationAction } from "@/actions/admin";
import { FormMessage } from "@/components/governance/FormMessage";
import { admin as copy, howIWork as hiw, humanDuration } from "@/copy";
import { getAdminData } from "@/lib/governance/queries";
import { servingProvenance } from "@/lib/provenance";
import { AuthError, requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function pct(n: number | null): string {
  return n === null ? copy.notMeasured : `${n.toFixed(1)} %`;
}

/**
 * `/admin` (T1.12) — platform operators only. Per-entity guard drop rate and
 * pulse skip ratio, usage tokens per day, tunnel health, the SB 243 report
 * date, the consultation flag, and a cost estimate.
 */
export default async function AdminPage({ searchParams }: Props) {
  const sp = await searchParams;
  try {
    await requireAdmin();
  } catch (err) {
    const unauth = err instanceof AuthError && err.status === 401;
    return (
      <section className="section">
        <h1>{copy.title}</h1>
        <p className="muted">{unauth ? "Please sign in first." : "You don't have access to this page."}</p>
        {unauth && (
          <p>
            <Link href="/sign-in" className="btn">Sign in</Link>
          </p>
        )}
      </section>
    );
  }

  const data = await getAdminData();
  // What each kami's gate says is actually serving it, so an operator can see at
  // a glance that a box is reporting what they think it is (and how old the
  // report is). Same source as the public "how I work" page — never asserted.
  const provenance = new Map(
    await Promise.all(data.entities.map(async (e) => [e.entity_id, await servingProvenance(e.slug)] as const)),
  );
  // Cost estimate: tokens over the last 7 days × the operator's card-hour cost,
  // which is a rough proxy until the GPU box reports tokens/hour (*verify*).
  const cost = data.card_hour_cost !== null ? (data.tokens_7d_total * data.card_hour_cost) / 1_000_000 : null;
  const gpuStale = !data.gpu_last_seen_at || Date.now() - Date.parse(data.gpu_last_seen_at) > 10 * 60_000;

  return (
    <section className="section">
      <h1>{copy.title}</h1>
      <p className="muted">{copy.intro}</p>
      <FormMessage ok={typeof sp.ok === "string" ? sp.ok : null} error={typeof sp.error === "string" ? sp.error : null} okText={{ saved: "Saved." }} />

      <h2 style={{ fontSize: "1.05rem" }}>{copy.entities}</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ padding: "0.4rem" }}>{copy.cols.name}</th>
              <th style={{ padding: "0.4rem" }}>{copy.cols.flags}</th>
              <th style={{ padding: "0.4rem" }}>{hiw.adminServingColumn}</th>
              <th style={{ padding: "0.4rem" }}>{copy.cols.guardDrop}</th>
              <th style={{ padding: "0.4rem" }}>{copy.cols.pulseSkip}</th>
              <th style={{ padding: "0.4rem" }}>{copy.cols.tokens7d}</th>
              <th style={{ padding: "0.4rem" }}>{copy.cols.consultation}</th>
            </tr>
          </thead>
          <tbody>
            {data.entities.map((e) => (
              <tr key={e.entity_id} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "0.4rem" }}>
                  <Link href={`/e/${e.slug}`}>{e.name}</Link>
                </td>
                <td style={{ padding: "0.4rem" }}>
                  {e.paused && <span className="chip">{copy.paused}</span>} {e.retired && <span className="chip">{copy.retired}</span>}
                </td>
                <td style={{ padding: "0.4rem" }} data-testid={`serving-${e.slug}`}>
                  {(() => {
                    const p = provenance.get(e.entity_id)!;
                    if (p.source === "unknown") return <span className="faint">{hiw.adminServingUnknown}</span>;
                    return (
                      <>
                        <span>{hiw.adminServingLine(p.placement, p.provider, p.model)}</span>
                        <br />
                        <span className={p.stale ? "chip chip-stale" : "faint"}>
                          {p.staleness_s === null
                            ? hiw.adminServingNoAge(p.source)
                            : hiw.adminServingAge(humanDuration(p.staleness_s), p.source)}
                        </span>
                      </>
                    );
                  })()}
                </td>
                <td style={{ padding: "0.4rem" }}>{pct(e.guard_drop_pct)}</td>
                <td style={{ padding: "0.4rem" }}>{pct(e.pulse_skip_pct)}</td>
                <td style={{ padding: "0.4rem" }}>{e.tokens_7d.toLocaleString()}</td>
                <td style={{ padding: "0.4rem" }}>
                  <form action={toggleConsultationAction} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <input type="hidden" name="entity_id" value={e.entity_id} />
                    <span>{e.consultation_done_at ? copy.consultationDone : copy.consultationPending}</span>
                    <button type="submit" className="btn">{copy.toggleConsultation}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>{copy.usage}</h2>
      {data.usage_by_day.length === 0 ? (
        <p className="muted">{copy.usageEmpty}</p>
      ) : (
        <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
          {data.usage_by_day.map((d) => (
            <li key={d.day} style={{ display: "flex", gap: "0.75rem" }}>
              <time dateTime={d.day} className="faint">{d.day}</time>
              <span>{d.tokens.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted" style={{ marginTop: "0.5rem" }}>
        {cost === null ? copy.costNoRate : copy.costLine(data.tokens_7d_total, cost.toFixed(2))}
      </p>
      <p className="faint" style={{ fontSize: "0.85rem" }}>{copy.usageUnit}</p>

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>{copy.tunnel}</h2>
      <p className={gpuStale ? "chip chip-stale" : "chip chip-live"} style={{ display: "inline-flex" }}>
        {data.gpu_last_seen_at ? copy.tunnelSeen(data.gpu_last_seen_at) : copy.tunnelNever}
        {gpuStale ? ` · ${copy.tunnelDown}` : ""}
      </p>

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>{copy.sb243}</h2>
      <form action={setConfigFieldAction} className="stack" style={{ maxWidth: "20rem" }}>
        <input type="hidden" name="key" value="sb243_report_due" />
        <input className="field" type="date" name="value" defaultValue={data.sb243_report_due ?? ""} />
        <button type="submit" className="btn">{copy.sb243Save}</button>
      </form>

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>{copy.cost}</h2>
      <form action={setConfigFieldAction} className="stack" style={{ maxWidth: "20rem" }}>
        <input type="hidden" name="key" value="card_hour_cost" />
        <label>
          <span className="eyebrow">config.card_hour_cost (USD)</span>
          <input className="field" type="number" step="0.01" name="value" defaultValue={data.card_hour_cost ?? ""} />
        </label>
        <button type="submit" className="btn">Save</button>
      </form>
    </section>
  );
}
