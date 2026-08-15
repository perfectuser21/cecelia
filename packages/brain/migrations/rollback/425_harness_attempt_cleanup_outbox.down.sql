BEGIN;

DO $$
DECLARE
  has_cleanup_evidence BOOLEAN;
BEGIN
  IF to_regclass('harness_attempt_cleanup_outbox') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM harness_attempt_cleanup_outbox)'
      INTO has_cleanup_evidence;
    IF has_cleanup_evidence THEN
      RAISE EXCEPTION 'cleanup_outbox_rollback_nonempty';
    END IF;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS terminalize_v2_run_active_attempts ON initiative_runs;
DROP FUNCTION IF EXISTS terminalize_v2_run_active_attempts();

DROP TRIGGER IF EXISTS guard_harness_attempt_parent_run_active ON harness_attempts;
DROP TRIGGER IF EXISTS guard_harness_attempt_insert_parent_run ON harness_attempts;
DROP TRIGGER IF EXISTS guard_harness_attempt_terminal_identity ON harness_attempts;
DROP FUNCTION IF EXISTS guard_harness_attempt_parent_run_active();
DROP FUNCTION IF EXISTS guard_harness_attempt_insert_parent_run();
DROP FUNCTION IF EXISTS guard_harness_attempt_terminal_identity();

DROP TRIGGER IF EXISTS enqueue_terminal_harness_attempt_cleanup ON harness_attempts;
DROP FUNCTION IF EXISTS enqueue_terminal_harness_attempt_cleanup();

DO $$
BEGIN
  IF to_regclass('harness_attempt_cleanup_outbox') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS guard_harness_attempt_cleanup_outbox_mutation ON harness_attempt_cleanup_outbox';
  END IF;
END;
$$;
DROP FUNCTION IF EXISTS guard_harness_attempt_cleanup_outbox_mutation();

DROP TABLE IF EXISTS harness_attempt_cleanup_outbox;
ALTER TABLE harness_attempts DROP COLUMN IF EXISTS parent_run_terminal;

DELETE FROM schema_version WHERE version = '425';

COMMIT;
