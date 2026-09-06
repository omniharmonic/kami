/**
 * POST /e/[slug]/chat — the streaming chat relay (architecture §5.5).
 *
 * Next.js forbids a `route.ts` beside the `page.tsx` at `/e/[slug]/chat`, so
 * the handler lives here and `src/proxy.ts` rewrites `POST /e/[slug]/chat`
 * to this path; the public URL stays the architected one.
 */
import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { productionChatDeps } from "@/lib/chat-deps";
import { handleChat } from "@/lib/chat-handler";
import { ANON_COOKIE, ANON_COOKIE_MAX_AGE_S, clientIp, ipHash, mintAnonKey, verifyAnonKey } from "@/lib/anon";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const jar = await cookies();
  const hdrs = await headers();

  let anonKey = verifyAnonKey(jar.get(ANON_COOKIE)?.value);
  let setCookie: string | null = null;
  if (!anonKey) {
    setCookie = mintAnonKey();
    anonKey = verifyAnonKey(setCookie);
  }
  const session = await getSession();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const res = await handleChat(productionChatDeps, {
    slug,
    body,
    anonKey,
    userId: session?.user.id ?? null,
    ipHash: ipHash(clientIp(hdrs)),
    signal: req.signal,
  });

  if (setCookie) {
    const out = new NextResponse(res.body, { status: res.status, headers: res.headers });
    out.cookies.set(ANON_COOKIE, setCookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ANON_COOKIE_MAX_AGE_S });
    return out;
  }
  return res;
}
