# Runbook — data retention

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<platform>/api/cron/retention | jq
```

Runs nightly at 09:45 UTC. It is the job that makes the promise on the "How I work" page true, so
when it stops running, a published commitment is being broken — treat a failure as an incident of
its own kind, not as a cron blip.

---

## What it does, exactly

| Data | Rule | Where |
|---|---|---|
| `chat_messages` | deleted after **90 days**, unless that session set `contribute_opt_in` | `runRetention` |
| `chat_sessions` | deleted with their messages when empty and not opted in — they carry an IP hash | `runRetention` |
| `usage_events` | after 90 days, aggregated into daily buckets in `config.usage_daily.<slug>` and the raw rows deleted | `runRetention` |
| evidence files | deleted **on request**; where an attestation references one, the file goes and its `sha256` stays | `/me` → "Ask to remove my evidence files" |
| backups | 90-day lifecycle on the R2 prefix; profiles tarred nightly and encrypted | `infra/box/backup.sh`, R2 lifecycle rule |
| `entity_events` | **never deleted.** It is the append-only audit log; it has no UPDATE or DELETE grant | by design |

The report the job returns tells you what it did: `chat_messages_deleted`,
`chat_sessions_deleted`, `chat_messages_kept_opt_in`, `usage_events_aggregated`,
`usage_daily_buckets`, and the `cutoff` it used.

## Check it monthly

```bash
# Nothing older than the cutoff should survive without an opt-in.
psql "$DATABASE_URL" -c "select count(*) from chat_messages m
  left join chat_sessions s on s.id = m.session_id
  where m.at < now() - interval '90 days' and coalesce(s.contribute_opt_in, false) = false;"
```

The answer must be **0**. If it is not, the job has not run, or it errored partway. Look at the
last few `entity_events` rows for the job, run it by hand, and re-check.

Then spot-check the other half: `select count(*) from usage_events where at < now() - interval '90
days';` should also be 0, with the equivalent daily buckets present in `config.usage_daily.<slug>`.

## Handling a deletion request

1. **From the person themselves:** they do it, on `/me` — export their data, delete their chat
   sessions, request evidence removal. Point them there first; self-service is faster and leaves a
   cleaner record than you doing it for them.
2. **By email, or for someone who cannot sign in:** verify they are who they say they are before
   deleting anything. An unverified deletion request is an attack vector.
3. **Evidence photographs:** the file is deleted from object storage. Where a signed attestation
   references it, `evidence_files.sha256` stays, because otherwise the attestation stops being
   checkable. **Say that to the person, plainly** — it is in the licence they accepted, and it is
   the one part people are surprised by.
4. **Chats they contributed to the training set:** if they opted in and now want out, delete the
   messages and note that a model already fine-tuned on them cannot be un-trained. Do not imply
   otherwise. If a fine-tune is pending, remove the rows before the dataset is built.
5. **What you cannot delete:** anything in `entity_events`, and any on-chain attestation. Both are
   public, append-only records by design. An attestation can be **revoked**, which is the honest
   remedy, and revoking is what to offer.
6. Record what you did and when, in the ticket and in the event log.

## Restore, and rehearsing it

Rehearse before phase 2, and after that once a quarter. A backup nobody has restored is a hope.

```bash
# Profiles: age -d, zstd -d, untar into ~/.hermes — then redeploy from the repo instead of trusting it.
pnpm --filter @kami/profile-scripts run deploy-profile <slug> --host box
```

- **Neon** has point-in-time restore for 30 days (*verify* the plan), plus a nightly `pg_dump` to a
  separate R2 prefix with a 90-day lifecycle. Restore into a **branch**, never over production, and
  compare row counts before you promote anything.
- **A restore can resurrect deleted chats.** After any restore that crosses a retention boundary,
  run the retention job immediately and check the count query above returns 0. This is the failure
  mode nobody expects: the backup quietly undoing a deletion the person asked for.
- **Evidence** is versioned in R2; restoring a version of a file someone asked to have deleted is
  the same failure. Check the deletion requests since the backup's date before restoring a bucket.
- **Chain state needs no backup.** The attestation index is rebuildable from EAS.

## If the job has not run

1. Check the Vercel cron ran at all, and whether it 401'd on `CRON_SECRET`.
2. Run it by hand with the curl at the top of this file and read the report.
3. If it fails partway, it is written to be safely re-runnable — run it again rather than deleting
   by hand.
4. If it has been failing for more than a few days, that is a broken public promise: say so on the
   "How I work" page when you fix it, in one line. Nobody will mind the honesty and everybody would
   mind the silence.
