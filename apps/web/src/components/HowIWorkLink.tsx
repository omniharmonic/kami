import Link from "next/link";
import { howIWork } from "@/copy";

export function HowIWorkLink({ slug }: { slug: string }) {
  return (
    <section className="section" aria-labelledby="hiw-h">
      <h2 id="hiw-h">{howIWork.link}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{howIWork.guardBody}</p>
      <Link href={`/e/${slug}/how-i-work`} className="btn">
        {howIWork.link} →
      </Link>
    </section>
  );
}
