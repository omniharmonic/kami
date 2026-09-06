import type { Metadata } from "next";
import Link from "next/link";
import { acceptInviteAction } from "@/actions/governance";
import { FormMessage } from "@/components/governance/FormMessage";
import { guardian as copy } from "@/copy";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.acceptTitle, robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The link in the invitation email. The token is never logged or rendered back. */
export default async function AcceptInvitePage({ searchParams }: Props) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const session = await getSession();
  const accepted = sp.ok === "accepted";

  return (
    <section className="section">
      <h1>{copy.acceptTitle}</h1>
      <p className="muted">{copy.acceptIntro}</p>
      <FormMessage ok={typeof sp.ok === "string" ? sp.ok : null} error={typeof sp.error === "string" ? sp.error : null} okText={{ accepted: "Accepted. You are now a guardian." }} />
      {accepted ? (
        <p>
          <Link href="/guardian" className="btn btn-primary">{copy.title}</Link>
        </p>
      ) : !session ? (
        <p>
          <Link href="/sign-in" className="btn">{copy.acceptSignIn}</Link>
        </p>
      ) : (
        <form action={acceptInviteAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn btn-primary" disabled={!token}>{copy.acceptButton}</button>
        </form>
      )}
    </section>
  );
}
