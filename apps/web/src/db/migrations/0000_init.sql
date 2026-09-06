CREATE TYPE "public"."archetype" AS ENUM('creek', 'watershed', 'reservoir', 'mountain', 'bioregion');--> statement-breakpoint
CREATE TYPE "public"."attestation_mode" AS ENUM('onchain', 'offchain');--> statement-breakpoint
CREATE TYPE "public"."bounty_status" AS ENUM('drafted', 'held_by_guard', 'open', 'claimed', 'in_review', 'paid', 'deferred', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."donation_rail" AS ENUM('card', 'usdc_direct', 'stablecoin_checkout');--> statement-breakpoint
CREATE TYPE "public"."entity_role" AS ENUM('guardian', 'evaluator', 'steward');--> statement-breakpoint
CREATE TYPE "public"."mood" AS ENUM('asleep', 'content', 'concerned', 'distressed', 'celebrating');--> statement-breakpoint
CREATE TYPE "public"."need_state" AS ENUM('live', 'stale', 'missing', 'superseded', 'unbanded');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('succeeded', 'partial', 'failed', 'unverifiable');--> statement-breakpoint
CREATE TYPE "public"."payout_rail" AS ENUM('usdc_safe', 'usdc_roles', 'fiat');--> statement-breakpoint
CREATE TYPE "public"."proposal_author" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('ok', 'warning', 'critical', 'unknown');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_roles" (
	"entity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "entity_role" NOT NULL,
	"hat_id" numeric,
	"invited_at" timestamp with time zone DEFAULT now(),
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "entity_roles_entity_id_user_id_role_pk" PRIMARY KEY("entity_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "guardian_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"email" text,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"accepted_user_id" text,
	CONSTRAINT "guardian_invites_email_lower" CHECK ("guardian_invites"."email" is null or "guardian_invites"."email" = lower("guardian_invites"."email"))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "steward_orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_note" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"privy_did" text,
	"wallet_address" text,
	"passport_score" numeric,
	"passport_checked_at" timestamp with time zone,
	"platform_admin" boolean DEFAULT false NOT NULL,
	"age_gate_ok" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_privy_did_unique" UNIQUE("privy_did"),
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"archetype" "archetype" NOT NULL,
	"steward_org_id" text,
	"binding_version" integer,
	"soul_version" integer,
	"safe_address" text,
	"chain_id" integer,
	"proposer_address" text,
	"guardians_hat_id" numeric,
	"hermes_profile" text,
	"rive_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cosmetics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consultation_md" text,
	"consultation_done_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"eas_uid_registered" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "entities_slug_unique" UNIQUE("slug"),
	CONSTRAINT "entities_hermes_profile_unique" UNIQUE("hermes_profile"),
	CONSTRAINT "entities_id_format" CHECK ("entities"."id" ~ '^entity/[a-z0-9-]+$')
);
--> statement-breakpoint
CREATE TABLE "entity_bindings" (
	"entity_id" text NOT NULL,
	"binding_version" integer NOT NULL,
	"binding" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"review" "review_state" DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "entity_bindings_entity_id_binding_version_pk" PRIMARY KEY("entity_id","binding_version")
);
--> statement-breakpoint
CREATE TABLE "souls" (
	"entity_id" text NOT NULL,
	"soul_version" integer NOT NULL,
	"hard_rules_version" text NOT NULL,
	"voice_md" text NOT NULL,
	"edited_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "souls_entity_id_soul_version_pk" PRIMARY KEY("entity_id","soul_version")
);
--> statement-breakpoint
CREATE TABLE "guard_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text,
	"at" timestamp with time zone DEFAULT now(),
	"context" text NOT NULL,
	"sentence" text NOT NULL,
	"unmatched" jsonb NOT NULL,
	"action" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "need_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text,
	"as_of" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"mood" "mood" NOT NULL,
	"stale_driving" boolean NOT NULL,
	CONSTRAINT "need_snapshots_entity_id_as_of_unique" UNIQUE("entity_id","as_of")
);
--> statement-breakpoint
CREATE TABLE "pulses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"woke" boolean NOT NULL,
	"snapshot_id" bigint,
	"deltas" jsonb,
	"text" text,
	"guard_result" text,
	"tokens_prompt" integer,
	"tokens_output" integer,
	CONSTRAINT "pulses_guard_result_check" CHECK ("pulses"."guard_result" in ('pass','dropped','held'))
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text,
	"at" timestamp with time zone DEFAULT now(),
	"job" text NOT NULL,
	"tokens_prompt" integer NOT NULL,
	"tokens_output" integer NOT NULL,
	"latency_ms" integer,
	"model" text
);
--> statement-breakpoint
CREATE TABLE "bounties" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"proposal_id" text,
	"strategy_id" text,
	"title" text NOT NULL,
	"why_md" text NOT NULL,
	"deliverable_md" text NOT NULL,
	"verification_tier" smallint NOT NULL,
	"evidence_spec" jsonb NOT NULL,
	"cap_usdc" numeric(12, 2) NOT NULL,
	"claim_limit" integer DEFAULT 1 NOT NULL,
	"deadline" date,
	"evaluator_hat_id" numeric,
	"twin_refs" text[] NOT NULL,
	"prediction" jsonb,
	"status" "bounty_status" DEFAULT 'drafted' NOT NULL,
	"spec_sha256" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"eas_uid_posted" text,
	"commons_path" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "bounties_verification_tier_check" CHECK ("bounties"."verification_tier" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"bounty_id" text,
	"user_id" text,
	"claimed_at" timestamp with time zone DEFAULT now(),
	"released_at" timestamp with time zone,
	CONSTRAINT "claims_bounty_id_user_id_unique" UNIQUE("bounty_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text,
	"evaluator_id" text,
	"outcome" "outcome" NOT NULL,
	"notes_md" text,
	"twin_snapshot_hash" text,
	"second_attestation_by" text,
	"offchain_attestation" jsonb,
	"eas_uid" text,
	"attested_at" timestamp with time zone,
	"audit_of" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "evidence_files" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text,
	"r2_key" text NOT NULL,
	"sha256" text NOT NULL,
	"mime" text,
	"bytes" integer,
	"exif" jsonb,
	"gps_lon" numeric,
	"gps_lat" numeric,
	"captured_at" timestamp with time zone,
	"in_app_capture" boolean NOT NULL,
	"licence_accepted_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"author_kind" "proposal_author" NOT NULL,
	"author_id" text,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"rank" integer,
	"rank_reason_md" text,
	"strategy_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"quarter" text NOT NULL,
	"memo_md" text NOT NULL,
	"guard_result" text,
	"comment_open_until" timestamp with time zone,
	"ratified_by" text,
	"ratified_at" timestamp with time zone,
	"commons_path" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "strategies_entity_id_quarter_unique" UNIQUE("entity_id","quarter")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text,
	"submitted_at" timestamp with time zone DEFAULT now(),
	"note_md" text,
	"evidence_summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"donor_user_id" text,
	"rail" "donation_rail" NOT NULL,
	"gross" numeric(12, 2),
	"fee" numeric(12, 2),
	"net" numeric(12, 2),
	"currency" text,
	"stripe_session_id" text,
	"chain_tx_hash" text,
	"received_at" timestamp with time zone DEFAULT now(),
	"reported_in" text,
	CONSTRAINT "donations_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "donor_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"month" date NOT NULL,
	"data" jsonb NOT NULL,
	"narrative_md" text,
	"guard_result" text,
	"public_md" text,
	"commons_path" text,
	"sent_at" timestamp with time zone,
	"donors_notified" integer,
	"donors_total" integer,
	CONSTRAINT "donor_reports_entity_id_month_unique" UNIQUE("entity_id","month")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text,
	"rail" "payout_rail" NOT NULL,
	"amount_usdc" numeric(12, 2) NOT NULL,
	"usd_value_at_payment" numeric(12, 2),
	"safe_tx_hash" text,
	"tx_hash" text,
	"executed_at" timestamp with time zone,
	"eas_uid_completed" text,
	"recipient_address" text,
	"recipient_user_id" text
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text,
	"at" timestamp with time zone DEFAULT now(),
	"ok" boolean NOT NULL,
	"findings" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safe_proposals" (
	"safe_tx_hash" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"submission_id" text,
	"nonce" integer,
	"to_address" text,
	"amount_usdc" numeric(12, 2),
	"proposed_at" timestamp with time zone DEFAULT now(),
	"confirmations" integer DEFAULT 0 NOT NULL,
	"executed_tx_hash" text,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_forms" (
	"user_id" text NOT NULL,
	"tax_year" integer NOT NULL,
	"cumulative_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"form_kind" text,
	"collected_by" text,
	"collected_at" timestamp with time zone,
	CONSTRAINT "tax_forms_user_id_tax_year_pk" PRIMARY KEY("user_id","tax_year")
);
--> statement-breakpoint
CREATE TABLE "treasury_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"amount_usdc" numeric(12, 2),
	"tx_hash" text,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "attestations" (
	"uid" text PRIMARY KEY NOT NULL,
	"schema" text NOT NULL,
	"mode" "attestation_mode" NOT NULL,
	"attester" text NOT NULL,
	"entity_id" text,
	"ref_uid" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"timestamped_tx" text,
	"timestamped_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reputation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"function_version" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"uids" text[] NOT NULL,
	"root_of_uids" text NOT NULL,
	"scores_uri" text NOT NULL,
	"eas_uid_snapshot" text
);
--> statement-breakpoint
CREATE TABLE "reputation_scores" (
	"run_id" text NOT NULL,
	"subject" text NOT NULL,
	"entity_id" text NOT NULL,
	"n" numeric,
	"p" numeric,
	"score" numeric,
	"passport_ok" boolean,
	CONSTRAINT "reputation_scores_run_id_subject_entity_id_pk" PRIMARY KEY("run_id","subject","entity_id")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" text,
	"at" timestamp with time zone DEFAULT now(),
	"role" text NOT NULL,
	"content" text NOT NULL,
	"toolcalls" jsonb,
	"guard_dropped" integer DEFAULT 0,
	"reminder" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"user_id" text,
	"anon_key" text,
	"ip_hash" text,
	"started_at" timestamp with time zone DEFAULT now(),
	"contribute_opt_in" boolean DEFAULT false NOT NULL,
	"turns" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "commons_notes" (
	"path" text PRIMARY KEY NOT NULL,
	"vault" text NOT NULL,
	"entity_id" text,
	"kind" text NOT NULL,
	"updated_at_seen" timestamp with time zone,
	"content_sha256" text,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "entity_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text,
	"at" timestamp with time zone DEFAULT now(),
	"actor" text,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pause_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text,
	"at" timestamp with time zone DEFAULT now(),
	"by_user" text,
	"action" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summon_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"step" integer,
	"data" jsonb,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_roles" ADD CONSTRAINT "entity_roles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_roles" ADD CONSTRAINT "entity_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_invites" ADD CONSTRAINT "guardian_invites_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_invites" ADD CONSTRAINT "guardian_invites_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_steward_org_id_steward_orgs_id_fk" FOREIGN KEY ("steward_org_id") REFERENCES "public"."steward_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_bindings" ADD CONSTRAINT "entity_bindings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_bindings" ADD CONSTRAINT "entity_bindings_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "souls" ADD CONSTRAINT "souls_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "souls" ADD CONSTRAINT "souls_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_events" ADD CONSTRAINT "guard_events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "need_snapshots" ADD CONSTRAINT "need_snapshots_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulses" ADD CONSTRAINT "pulses_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulses" ADD CONSTRAINT "pulses_snapshot_id_need_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."need_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_evaluator_id_users_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_second_attestation_by_users_id_fk" FOREIGN KEY ("second_attestation_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_audit_of_evaluations_id_fk" FOREIGN KEY ("audit_of") REFERENCES "public"."evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_ratified_by_users_id_fk" FOREIGN KEY ("ratified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_user_id_users_id_fk" FOREIGN KEY ("donor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_reports" ADD CONSTRAINT "donor_reports_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_proposals" ADD CONSTRAINT "safe_proposals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_proposals" ADD CONSTRAINT "safe_proposals_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_forms" ADD CONSTRAINT "tax_forms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_scores" ADD CONSTRAINT "reputation_scores_run_id_reputation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reputation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commons_notes" ADD CONSTRAINT "commons_notes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_events" ADD CONSTRAINT "entity_events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_events" ADD CONSTRAINT "pause_events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_events" ADD CONSTRAINT "pause_events_by_user_users_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summon_drafts" ADD CONSTRAINT "summon_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "entities_archetype_idx" ON "entities" USING btree ("archetype") WHERE "entities"."retired_at" is null;--> statement-breakpoint
CREATE INDEX "guard_events_entity_id_at_idx" ON "guard_events" USING btree ("entity_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "need_snapshots_entity_id_as_of_idx" ON "need_snapshots" USING btree ("entity_id","as_of" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pulses_entity_id_at_idx" ON "pulses" USING btree ("entity_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "usage_events_entity_id_at_idx" ON "usage_events" USING btree ("entity_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bounties_entity_id_status_idx" ON "bounties" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "attestations_entity_id_schema_idx" ON "attestations" USING btree ("entity_id","schema");--> statement-breakpoint
CREATE INDEX "chat_messages_at_idx" ON "chat_messages" USING btree ("at");--> statement-breakpoint
CREATE INDEX "chat_messages_session_id_idx" ON "chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "chat_sessions_anon_key_idx" ON "chat_sessions" USING btree ("anon_key");--> statement-breakpoint
CREATE INDEX "chat_sessions_ip_hash_idx" ON "chat_sessions" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "entity_events_entity_id_id_idx" ON "entity_events" USING btree ("entity_id","id");