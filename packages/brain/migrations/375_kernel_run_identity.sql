-- Migration 375: Kernel run identity and one-active-run ownership.
--
-- Historical v2 rows with NULL identity are preserved for the trust-reconstruction
-- phase. The INSERT trigger fences every new v2 row without forcing an unsafe
-- guessed backfill. The unique index deliberately fails migration if production
-- still contains more than one active task-linked run; operators must drain and
-- reconcile that conflict before retrying the migration.

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS created_source TEXT;

ALTER TABLE initiative_runs
  DROP CONSTRAINT IF EXISTS initiative_runs_created_source_check;
ALTER TABLE initiative_runs
  ADD CONSTRAINT initiative_runs_created_source_check
  CHECK (
    created_source IS NULL
    OR created_source IN (
      'kernel_dispatch',
      'foreground_handoff',
      'legacy_relay',
      'explicit_recovery',
      'historical_reconstruction'
    )
  ) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'initiative_runs_current_task_fk'
       AND conrelid = 'initiative_runs'::regclass
  ) THEN
    ALTER TABLE initiative_runs
      ADD CONSTRAINT initiative_runs_current_task_fk
      FOREIGN KEY (current_task_id)
      REFERENCES tasks (id)
      NOT VALID;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION enforce_v2_run_insert_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.orchestrator_version = 'v2'
     AND (NEW.current_task_id IS NULL OR NEW.created_source IS NULL) THEN
    RAISE EXCEPTION
      'v2 initiative run requires current_task_id and created_source'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_v2_run_insert_identity ON initiative_runs;
CREATE TRIGGER trg_enforce_v2_run_insert_identity
BEFORE INSERT ON initiative_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_v2_run_insert_identity();

CREATE UNIQUE INDEX IF NOT EXISTS uq_initiative_runs_active_task_v2
  ON initiative_runs (current_task_id)
  WHERE orchestrator_version = 'v2'
    AND current_task_id IS NOT NULL
    AND phase NOT IN ('done', 'failed');
