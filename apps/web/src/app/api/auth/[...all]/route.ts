import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = (req: Request) => getAuth().handler(req);
export const GET = handle;
export const POST = handle;
