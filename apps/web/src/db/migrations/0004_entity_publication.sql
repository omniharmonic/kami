-- Publication is an explicit lifecycle decision, independent of consultation.
ALTER TABLE "entities" ADD COLUMN "published_at" timestamp with time zone;
--> statement-breakpoint
-- Preserve precisely the historical visibility set. Unconsulted/private beings
-- stay private; this migration does not publish Boulder Creek or any other draft.
UPDATE "entities" SET "published_at" = "consultation_done_at"
WHERE "consultation_done_at" IS NOT NULL;
