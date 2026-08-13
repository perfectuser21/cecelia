BEGIN;

DROP TRIGGER IF EXISTS map_recovery_contracts_immutable
  ON map_recovery_contracts;
DROP FUNCTION IF EXISTS reject_map_recovery_contract_mutation();
ALTER TABLE map_recovery_contracts
  DROP CONSTRAINT IF EXISTS map_recovery_contracts_attempt_id_fkey;
DROP INDEX IF EXISTS idx_work_routing_receipts_task_created;
DO $$
BEGIN
  IF EXISTS (
    SELECT task_id FROM work_routing_receipts
     GROUP BY task_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot_restore_work_routing_receipts_task_unique';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='work_routing_receipts'::regclass
       AND conname='work_routing_receipts_task_id_key'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_task_id_key UNIQUE(task_id);
  END IF;
END
$$;
DELETE FROM schema_version WHERE version = '416';

COMMIT;
