import Link from "next/link";
import { grants } from "@/copy/grants";

export type GrantCardView = {
  id: string; title: string; description: string; status: string;
  budget: string; closesAt: string; applications: number; acceptingApplications?: boolean;
};

export function GrantCards({ rounds, slug }: { rounds: GrantCardView[]; slug: string }) {
  if (!rounds.length) return <p className="muted">{grants.empty}</p>;
  return <ul className="stack" style={{ listStyle: "none", padding: 0 }}>{rounds.map(round => <li key={round.id} className="card" style={{ padding: 18 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "baseline" }}><h3 style={{ margin: 0 }}><Link href={`/e/${slug}/grants#${round.id}`}>{round.title}</Link></h3><span className="chip">{round.status === "open" && round.acceptingApplications === false ? "Applications unavailable" : grants.status[round.status] ?? round.status}</span></div>
    <p style={{ whiteSpace: "pre-wrap", maxWidth: "70ch", fontSize: 13 }}>{round.description}</p>
    <dl style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px", margin: 0, fontSize: 12 }}>
      <div><dt>Planning budget</dt><dd style={{ margin: "4px 0", fontWeight: 600 }}>{round.budget} USDC</dd></div>
      <div><dt>Applications</dt><dd style={{ margin: "4px 0", fontWeight: 600 }}>{round.applications}</dd></div>
      <div><dt>Deadline</dt><dd style={{ margin: "4px 0" }}><time dateTime={round.closesAt}>{round.closesAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time></dd></div>
    </dl>
  </li>)}</ul>;
}
