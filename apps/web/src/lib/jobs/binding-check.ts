/**
 * Nightly `binding-check` (architecture §3, "When the twin supersedes a
 * place"): `checkSupersession` per entity; a successor drafts the next
 * binding version as `pending_review`; the findings go to
 * `config.binding_findings.<slug>` so the next `status.json` marks the need
 * superseded with the templated line. Audit events are appended only when
 * the findings change, so a quiet night adds nothing to the chain.
 */
import { and, desc, eq } from "drizzle-orm";
import { bindingSha256, canonicalJson, checkSupersession, type Binding, type SupersessionFinding } from "@kami/binding";
import type { TwinClient } from "@kami/twin-client";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { activeEntities, getConfig, setConfig } from "./common";
import { loadCurrentBinding } from "./needs";
import { getTwinClient } from "./twin";

export type BindingCheckResult = {
  slug: string;
  status: "ok" | "skipped" | "drafted" | "findings" | "error";
  reason?: string;
  findings?: SupersessionFinding[];
  draft_version?: number;
  changed?: boolean;
};

/** What makes two drafts "the same proposal": the body, not the clock. */
function draftFingerprint(b: Binding): string {
  return canonicalJson({ anchor: b.anchor, stream_id: b.stream_id, members: b.members, watersheds: b.watersheds, needs: b.needs, boundary: b.boundary });
}

export async function runBindingCheck(opts: { db: DbOrTx; twin?: TwinClient; now?: Date; slug?: string }): Promise<BindingCheckResult[]> {
  const now = opts.now ?? new Date();
  const twin = opts.twin ?? getTwinClient();
  const out: BindingCheckResult[] = [];
  for (const entity of await activeEntities(opts.db, opts.slug)) {
    try {
      const current = await loadCurrentBinding(opts.db, entity);
      if ("error" in current) {
        out.push({ slug: entity.slug, status: "skipped", reason: current.error });
        continue;
      }
      const result = await checkSupersession(current.binding, twin, { now });
      const key = `binding_findings.${entity.slug}`;
      const prior = (await getConfig<SupersessionFinding[]>(opts.db, key)) ?? [];
      const changed = canonicalJson(prior) !== canonicalJson(result.findings);
      await setConfig(opts.db, key, result.findings, now);
      if (changed) {
        await appendEntityEvent(opts.db, {
          entity_id: entity.id,
          actor: "cron:binding-check",
          kind: "binding.findings",
          payload: { binding_version: current.version, findings: result.findings },
          at: now,
        });
      }

      if (!result.draft) {
        out.push({ slug: entity.slug, status: result.findings.length ? "findings" : "ok", findings: result.findings, changed });
        continue;
      }

      const fp = draftFingerprint(result.draft);
      const pending = await opts.db
        .select()
        .from(schema.entityBindings)
        .where(and(eq(schema.entityBindings.entityId, entity.id), eq(schema.entityBindings.review, "pending_review")))
        .orderBy(desc(schema.entityBindings.bindingVersion));
      const dup = pending.find((p) => draftFingerprint(p.binding as Binding) === fp);
      if (dup) {
        out.push({ slug: entity.slug, status: "findings", reason: `draft v${dup.bindingVersion} already pending`, findings: result.findings, draft_version: dup.bindingVersion, changed });
        continue;
      }
      const [max] = await opts.db.select({ v: schema.entityBindings.bindingVersion }).from(schema.entityBindings).where(eq(schema.entityBindings.entityId, entity.id)).orderBy(desc(schema.entityBindings.bindingVersion)).limit(1);
      const version = (max?.v ?? current.version) + 1;
      const draft: Binding = { ...result.draft, binding_version: version };
      const sha = bindingSha256(draft);
      await opts.db.insert(schema.entityBindings).values({ entityId: entity.id, bindingVersion: version, binding: draft, sha256: sha, review: "pending_review", createdAt: now });
      await appendEntityEvent(opts.db, {
        entity_id: entity.id,
        actor: "cron:binding-check",
        kind: "binding.supersession_drafted",
        payload: { from_version: current.version, draft_version: version, sha256: sha, successors: result.findings.filter((f) => f.successor).map((f) => ({ id: f.id, successor: f.successor })) },
        at: now,
      });
      out.push({ slug: entity.slug, status: "drafted", findings: result.findings, draft_version: version, changed });
    } catch (err) {
      out.push({ slug: entity.slug, status: "error", reason: (err as Error).message });
    }
  }
  return out;
}
