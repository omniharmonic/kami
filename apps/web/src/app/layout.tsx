import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { landing, nav } from "@/copy";

export const metadata: Metadata = {
  title: { default: landing.title, template: "%s · Kami" },
  description: landing.tagline,
  applicationName: "Kami",
  authors: [{ name: "Benjamin Life", url: "https://github.com/omniharmonic" }],
  openGraph: { type: "website", siteName: "Kami", title: landing.title, description: landing.tagline },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">{nav.skip}</a>
        <header className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: "var(--tap)", paddingBlock: "0.5rem" }}>
          <Link href="/" className="tap" style={{ fontWeight: 700, textDecoration: "none", color: "var(--ink)" }}>
            {nav.home}
          </Link>
          <nav aria-label="Account">
            <Link href="/sign-in" className="tap" style={{ paddingInline: "0.75rem" }}>
              {landing.signIn}
            </Link>
          </nav>
        </header>
        <main id="main" className="wrap" style={{ paddingBottom: "3rem" }}>
          {children}
        </main>
        <footer className="wrap faint" style={{ fontSize: "0.85rem", paddingBlock: "1.5rem", borderTop: "1px solid var(--line)" }}>
          <p style={{ margin: 0 }}>{landing.noToken} {landing.noTokenBody}</p>
          <p style={{ margin: "0.4rem 0 0" }}>{landing.attribution} {landing.twinAttribution}</p>
        </footer>
      </body>
    </html>
  );
}
