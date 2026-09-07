-- Grant rounds organize proposals; no funds are reserved or paid.
CREATE TABLE "grant_applications" (
	"round_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grant_applications_round_id_proposal_id_pk" PRIMARY KEY("round_id","proposal_id")
);
--> statement-breakpoint
CREATE TABLE "grant_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"title" text NOT NULL,
	"purpose_md" text NOT NULL,
	"budget_usdc" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"application_deadline" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "grant_rounds_status_check" CHECK ("grant_rounds"."status" in ('draft','open','closed')),
	CONSTRAINT "grant_rounds_budget_positive" CHECK ("grant_rounds"."budget_usdc" > 0)
);
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_round_id_grant_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."grant_rounds"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "grant_rounds" ADD CONSTRAINT "grant_rounds_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "grant_rounds" ADD CONSTRAINT "grant_rounds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "grant_rounds_entity_status_idx" ON "grant_rounds" USING btree ("entity_id","status");
--> statement-breakpoint
-- Cross-entity associations are invalid even outside the application's action.
CREATE FUNCTION grant_application_scope() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM grant_rounds r JOIN proposals p ON p.entity_id=r.entity_id
  WHERE r.id=NEW.round_id AND p.id=NEW.proposal_id
 ) THEN
  RAISE EXCEPTION 'grant application must belong to the round entity' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER grant_application_scope_check BEFORE INSERT OR UPDATE ON grant_applications
FOR EACH ROW EXECUTE FUNCTION grant_application_scope();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON grant_rounds, grant_applications TO kami_app;
