-- entity_events is the hash-chained audit log (Appendix B: "app role: INSERT and
-- SELECT only"). Two layers:
--  1. the application role `kami_app` (created here if absent; *verify* that
--     Neon's owner role may CREATE ROLE — otherwise create it in the console
--     and this block is a no-op) is granted SELECT/INSERT and explicitly denied
--     UPDATE/DELETE/TRUNCATE on entity_events;
--  2. a trigger refuses UPDATE/DELETE/TRUNCATE for every role, so the chain
--     stays append-only even when the app connects as the owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kami_app') THEN
    CREATE ROLE kami_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO kami_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kami_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kami_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON entity_events FROM kami_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION entity_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'entity_events is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS entity_events_no_update_delete ON entity_events;
--> statement-breakpoint
CREATE TRIGGER entity_events_no_update_delete
  BEFORE UPDATE OR DELETE ON entity_events
  FOR EACH ROW EXECUTE FUNCTION entity_events_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS entity_events_no_truncate ON entity_events;
--> statement-breakpoint
CREATE TRIGGER entity_events_no_truncate
  BEFORE TRUNCATE ON entity_events
  FOR EACH STATEMENT EXECUTE FUNCTION entity_events_append_only();
