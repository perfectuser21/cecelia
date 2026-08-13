-- Rollback migration 413
DROP TRIGGER IF EXISTS work_routing_receipts_immutable ON work_routing_receipts;
DROP FUNCTION IF EXISTS reject_work_routing_receipt_mutation();
DROP TABLE IF EXISTS work_routing_receipts CASCADE;
DELETE FROM schema_version WHERE version = '413';
