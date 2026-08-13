DROP TRIGGER IF EXISTS trg_prevent_run_recovery_contract_mutation ON initiative_runs;
DROP FUNCTION IF EXISTS prevent_run_recovery_contract_mutation();
DROP INDEX IF EXISTS uq_initiative_runs_map_recovery_contract;
ALTER TABLE initiative_runs DROP COLUMN IF EXISTS map_recovery_contract_id;
DROP TRIGGER IF EXISTS map_recovery_consumptions_immutable ON map_recovery_consumptions;
DROP FUNCTION IF EXISTS reject_map_recovery_consumption_mutation();
DROP TABLE IF EXISTS map_recovery_consumptions;
ALTER TABLE map_recovery_contracts
  DROP CONSTRAINT IF EXISTS map_recovery_contracts_authority_check,
  DROP CONSTRAINT IF EXISTS map_recovery_contracts_base_sha_check,
  DROP CONSTRAINT IF EXISTS map_recovery_contracts_receipt_task_fk,
  DROP CONSTRAINT IF EXISTS map_recovery_contracts_receipt_unique;
ALTER TABLE work_routing_receipts
  DROP CONSTRAINT IF EXISTS work_routing_receipts_id_task_unique;
DELETE FROM schema_version WHERE version = '418';
