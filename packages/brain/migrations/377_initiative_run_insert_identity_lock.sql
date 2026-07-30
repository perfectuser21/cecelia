-- Migration 377: serialize every initiative_runs INSERT with legacy adapters.
--
-- The compatibility PATCH resolves a unique historical candidate while
-- holding either the full initiative key or its eight-character prefix.
-- A trigger is required because legacy relay writers still insert directly;
-- relying on every application caller to remember an advisory lock leaves a
-- TOCTOU window.

CREATE OR REPLACE FUNCTION lock_initiative_run_insert_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_id text;
BEGIN
  normalized_id := replace(NEW.initiative_id::text, '-', '');
  PERFORM pg_advisory_xact_lock(
    hashtextextended('relay-prefix:' || lower(substr(normalized_id, 1, 8)), 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('relay-initiative:' || NEW.initiative_id::text, 0)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initiative_run_insert_identity_lock
  ON initiative_runs;

CREATE TRIGGER initiative_run_insert_identity_lock
BEFORE INSERT ON initiative_runs
FOR EACH ROW
EXECUTE FUNCTION lock_initiative_run_insert_identity();
