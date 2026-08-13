BEGIN;

DROP TRIGGER IF EXISTS map_recovery_contracts_immutable
  ON map_recovery_contracts;
DROP FUNCTION IF EXISTS reject_map_recovery_contract_mutation();
ALTER TABLE map_recovery_contracts
  DROP CONSTRAINT IF EXISTS map_recovery_contracts_attempt_id_fkey;
DROP INDEX IF EXISTS idx_work_routing_receipts_task_created;
DELETE FROM schema_version WHERE version = '416';

COMMIT;
