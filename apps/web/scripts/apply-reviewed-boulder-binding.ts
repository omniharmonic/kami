/** One-time steward-authorized installation of the reviewed watershed v2. */
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { BindingSchema, bindingSha256, validateBinding } from "@kami/binding";
import { TwinClient } from "@kami/twin-client";
import * as schema from "../src/db/schema";
import { appendEntityEvent, verifyEventChain } from "../src/db/events";
import { runNeedsJob } from "../src/lib/jobs/needs";
import { LocalDirPublisher } from "../src/lib/publish/local";

if (!process.argv.includes("--user-approved-v2") || !process.argv[2]) throw new Error("Explicit reviewed-v2 authorization and private connection file required");
const { DATABASE_URL } = JSON.parse(await readFile(process.argv[2], "utf8"));
const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
const db = drizzle(pool, { schema });
const id = "entity/boulder-creek";
try {
  const candidate = BindingSchema.parse(JSON.parse(await readFile(new URL("../../../profiles/boulder-creek/reviews/binding-v2.proposed.json", import.meta.url), "utf8")));
  const twin = new TwinClient({ baseUrl: "https://data.bioregionaltwin.org", userAgent: "beings.earth/1.0 (steward-approved watershed setup)" });
  const validation = await validateBinding(candidate, twin);
  if (!validation.ok) throw new Error(JSON.stringify(validation));
  const approved = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.email, "synergy@benjaminlife.one"));
    if (!user?.emailVerified || !user.ageGateOk) throw new Error("Verified steward account with completed age gate required");
    const [role] = await tx.select().from(schema.entityRoles).where(and(eq(schema.entityRoles.entityId, id), eq(schema.entityRoles.userId, user.id), eq(schema.entityRoles.role, "steward"), isNotNull(schema.entityRoles.acceptedAt), isNull(schema.entityRoles.revokedAt)));
    if (!role) throw new Error("Accepted steward role required");
    const [entity] = await tx.select().from(schema.entities).where(eq(schema.entities.id, id)).for("update");
    if (!entity || entity.bindingVersion !== 1 || !entity.pausedAt || entity.consultationDoneAt || entity.retiredAt) throw new Error("Expected private, paused v1 entity; refusing to overwrite changed state");
    if (candidate.entity_id !== id || candidate.binding_version !== 2 || candidate.members.length !== 12 || candidate.needs.length !== 5) throw new Error("Unexpected candidate");
    const binding = BindingSchema.parse({ ...candidate, reviewed_by: user.id });
    const sha256 = bindingSha256(binding);
    const at = new Date();
    await tx.insert(schema.entityBindings).values({ entityId: id, bindingVersion: 2, binding, sha256, review: "approved", reviewedBy: user.id, reviewedAt: at });
    await tx.update(schema.entities).set({ bindingVersion: 2 }).where(eq(schema.entities.id, id));
    await appendEntityEvent(tx, { entity_id: id, actor: user.id, kind: "binding.approved", at, payload: { previous_version: 1, binding_version: 2, sha256, member_count: 12, needs: binding.needs.map(n => n.need), authorization: "Steward explicitly approved reviewed broader watershed v2 in setup session on 2026-09-07; private and paused retained." } });
    return { binding, sha256, approved_at: at.toISOString() };
  });
  await writeFile("/tmp/beings-approved-binding.json", JSON.stringify(approved, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ approved_version: 2, members: 12, needs: 5, paused: true, public: false, chain: await verifyEventChain(db, id) }));
  console.log(JSON.stringify(await runNeedsJob({ db, slug: "boulder-creek", twin, publisher: new LocalDirPublisher("/tmp/beings-private-needs") })));
} finally {
  await pool.end();
}
