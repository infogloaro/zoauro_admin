-- M04 Audit and Logs: database guard (doc 50 §3.2). Run by the migration/owner role, never by the application.
-- Prerequisite roles are created by infrastructure (docker/initdb/01-roles.sql locally):
--   zoauro_app    application runtime: INSERT + SELECT on the audit tables, nothing else
--   zoauro_purge  retention worker only: SELECT + DELETE (still blocked by the trigger unless the 3-year rule and flag hold)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zoauro_app')   THEN RAISE EXCEPTION 'role zoauro_app is missing: create it before running this migration'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zoauro_purge') THEN RAISE EXCEPTION 'role zoauro_purge is missing: create it before running this migration'; END IF;
END $$;

REVOKE ALL ON audit_logs, access_changes FROM zoauro_app, zoauro_purge, PUBLIC;
GRANT SELECT, INSERT ON audit_logs, access_changes TO zoauro_app;
GRANT SELECT, DELETE ON audit_logs, access_changes TO zoauro_purge;

CREATE OR REPLACE FUNCTION audit_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit rows are append-only (% on %)', TG_OP, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('zoauro.audit_purge', true) = 'on'
       AND OLD.created_at < now() - interval '3 years' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit rows cannot be deleted (% on %)', TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_guard      BEFORE UPDATE OR DELETE ON audit_logs     FOR EACH ROW       EXECUTE FUNCTION audit_block_mutation();
CREATE TRIGGER audit_logs_no_trunc   BEFORE TRUNCATE         ON audit_logs     FOR EACH STATEMENT EXECUTE FUNCTION audit_block_mutation();
CREATE TRIGGER access_changes_guard    BEFORE UPDATE OR DELETE ON access_changes FOR EACH ROW       EXECUTE FUNCTION audit_block_mutation();
CREATE TRIGGER access_changes_no_trunc BEFORE TRUNCATE         ON access_changes FOR EACH STATEMENT EXECUTE FUNCTION audit_block_mutation();
