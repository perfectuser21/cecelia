BEGIN;

DO $$
DECLARE
  has_consumptions BOOLEAN;
BEGIN
  IF to_regclass('planner_recovery_consumptions') IS NOT NULL THEN
    LOCK TABLE planner_recovery_consumptions IN ACCESS EXCLUSIVE MODE;
    SELECT EXISTS (SELECT 1 FROM planner_recovery_consumptions)
      INTO has_consumptions;
    IF has_consumptions THEN
      RAISE EXCEPTION 'planner_recovery_consumptions_rollback_nonempty'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

DROP TABLE IF EXISTS planner_recovery_consumptions;
DROP FUNCTION IF EXISTS reject_planner_recovery_consumption_mutation();
DROP FUNCTION IF EXISTS enforce_planner_recovery_consumption_authority();
DELETE FROM schema_version WHERE version = '429';

COMMIT;
