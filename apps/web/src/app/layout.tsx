import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { landing, nav } from "@/copy";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: { default: landing.title, template: "%s · beings.earth" },
  description: landing.tagline,
  applicationName: "beings.earth",
  authors: [{ name: "Benjamin Life", url: "https://github.com/omniharmonic" }],
  openGraph: {
    type: "website",
    siteName: "beings.earth",
    title: landing.title,
    description: landing.tagline,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          {nav.skip}
        </a>
        <header className="site-header">
          <Link href="/" className="site-brand">
            <span aria-hidden="true">✳</span>
            {nav.home}
          </Link>
          <nav aria-label="Main navigation" className="site-nav">
            <Link href="/" className="site-nav-secondary">Explore</Link>
            <Link href="/summon" className="site-nav-secondary">Summon a being</Link>
            {session ? <Link href="/guardian">Guardian dashboard</Link> : null}
          </nav>
          <Link href={session ? "/me" : "/sign-in"} className="site-sign-in" aria-label={session ? `My account: ${session.user.email}` : undefined}>
            {session ? nav.account : landing.signIn} <span aria-hidden="true">↗</span>
          </Link>
        </header>
        <main id="main" className="page-main">
          {children}
        </main>
        <footer
          className="wrap faint"
          style={{
            fontSize: "0.85rem",
            paddingBlock: "1.5rem",
            borderTop: "1px solid var(--line)",
          }}
        >
          <section aria-label="No token policy">
            <p style={{ margin: 0 }}>
              {landing.noToken} {landing.noTokenBody}
            </p>
          </section>
          <p style={{ margin: "0.4rem 0 0" }}>
            {landing.attribution} {landing.twinAttribution}
          </p>
        </footer>
      </body>
    </html>
  );
}
