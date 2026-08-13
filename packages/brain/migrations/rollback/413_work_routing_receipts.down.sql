BEGIN;

DROP TRIGGER IF EXISTS map_recovery_contracts_immutable ON map_recovery_contracts;
DROP TRIGGER IF EXISTS work_routing_receipts_immutable ON work_routing_receipts;
DROP FUNCTION IF EXISTS reject_map_recovery_contract_mutation();
DROP FUNCTION IF EXISTS reject_work_routing_receipt_mutation();
DROP TABLE IF EXISTS map_recovery_contracts;
DROP TABLE IF EXISTS work_routing_receipts;
DELETE FROM schema_version WHERE version = '413';

COMMIT;
