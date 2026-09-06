/**
 * The way in, from the entity's own page. Unobtrusive, and rendered only for
 * someone who holds a role on this kami — for everybody else the link is not
 * dimmed or disabled, it simply is not there, because "connect a brain" is not
 * a thing the public can act on.
 *
 * This is a server component so the role check happens on the server and the
 * link's absence is not a client-side decision.
 */
import Link from "next/link";
import { connect as copy } from "@/copy";
import { connectAccess } from "@/lib/connect/access";
import { getSession } from "@/lib/session";

export async function ConnectLink({ entity }: { entity: { id: string; slug: string; created_by?: string | null } }) {
  const session = await getSession();
  const access = await connectAccess(entity, session?.user ?? null);
  if (!access.may_view) return null;
  return (
    <p className="faint" style={{ fontSize: "0.85rem", marginTop: "1.5rem" }} data-testid="connect-link">
      <Link href={`/e/${entity.slug}/connect`}>{copy.link}</Link> — {copy.linkHint}
    </p>
  );
}
