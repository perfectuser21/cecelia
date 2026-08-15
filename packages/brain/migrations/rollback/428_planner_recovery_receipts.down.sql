BEGIN;

DO $$
DECLARE
  has_receipts BOOLEAN;
BEGIN
  IF to_regclass('planner_recovery_receipts') IS NOT NULL THEN
    LOCK TABLE planner_recovery_receipts IN ACCESS EXCLUSIVE MODE;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM planner_recovery_receipts)'
      INTO has_receipts;
    IF has_receipts THEN
      RAISE EXCEPTION 'planner_recovery_receipts_rollback_nonempty'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

DROP TABLE IF EXISTS planner_recovery_receipts;
DROP FUNCTION IF EXISTS reject_planner_recovery_receipt_mutation();
DROP FUNCTION IF EXISTS enforce_planner_recovery_receipt_authority();
DELETE FROM schema_version WHERE version = '428';

COMMIT;
