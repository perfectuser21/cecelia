BEGIN;

DO $$
DECLARE
  has_binding_column BOOLEAN;
  has_bound_runs BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid='initiative_runs'::regclass
       AND attname='planner_recovery_receipt_id'
       AND NOT attisdropped
  ) INTO has_binding_column;
  IF has_binding_column THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM initiative_runs
          WHERE planner_recovery_receipt_id IS NOT NULL
             OR created_source=''planner_recovery''
       )'
      INTO has_bound_runs;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM initiative_runs WHERE created_source='planner_recovery'
    ) INTO has_bound_runs;
  END IF;
  IF has_bound_runs THEN
    RAISE EXCEPTION 'planner_recovery_run_binding_rollback_nonempty'
      USING ERRCODE='23514';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS planner_recovery_run_binding_immutable ON initiative_runs;
DROP FUNCTION IF EXISTS reject_planner_recovery_run_binding_mutation();
DROP TRIGGER IF EXISTS planner_recovery_run_authority ON initiative_runs;
DROP FUNCTION IF EXISTS enforce_planner_recovery_run_authority();

ALTER TABLE initiative_runs
  DROP CONSTRAINT IF EXISTS initiative_runs_planner_recovery_receipt_unique,
  DROP CONSTRAINT IF EXISTS initiative_runs_planner_recovery_receipt_fk,
  DROP COLUMN IF EXISTS planner_recovery_receipt_id;

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

DELETE FROM schema_version WHERE version='430';

COMMIT;
