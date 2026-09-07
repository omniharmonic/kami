/**
 * PUT/GET /api/evidence/local/[key] — the development object store. Used only
 * when no R2 credentials are configured: `localStorage()` in
 * `src/lib/evidence/storage.ts` presigns URLs pointing here, signed with the
 * chat/auth secret and valid for 15 minutes. Files land under
 * `KAMI_DATA_DIR/evidence/…`. Never used in production, where R2 presigns
 * directly and these bytes never touch the app server.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { localPathFor, MAX_FILE_BYTES, verifyLocalSig } from "@/lib/evidence/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function check(req: Request, key: string): NextResponse | null {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig");
  if (!verifyLocalSig(key, exp, sig)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!key.startsWith("evidence/") || key.includes("..")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  const bad = check(req, key);
  if (bad) return bad;
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  const file = localPathFor(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  return new NextResponse(null, { status: 204 });
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  const bad = check(req, key);
  if (bad) return bad;
  try {
    const bytes = await fs.readFile(localPathFor(key));
    return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
