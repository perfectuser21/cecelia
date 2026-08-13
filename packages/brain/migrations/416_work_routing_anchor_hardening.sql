BEGIN;

CREATE INDEX IF NOT EXISTS idx_work_routing_receipts_task_created
  ON work_routing_receipts(task_id, created_at DESC);

UPDATE map_scope_repositories
   SET adapter_config = adapter_config ||
     '{"aliases":["perfectuser21/cecelia","https://github.com/perfectuser21/cecelia"]}'::jsonb
 WHERE scope_key = 'cecelia'
   AND repo = 'cecelia';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'map_recovery_contracts'::regclass
       AND conname = 'map_recovery_contracts_attempt_id_fkey'
  ) THEN
    ALTER TABLE map_recovery_contracts
      ADD CONSTRAINT map_recovery_contracts_attempt_id_fkey
      FOREIGN KEY (attempt_id) REFERENCES harness_attempts(id);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION reject_map_recovery_contract_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'map_recovery_contracts_append_only';
END
$$;

DROP TRIGGER IF EXISTS map_recovery_contracts_immutable
  ON map_recovery_contracts;
CREATE TRIGGER map_recovery_contracts_immutable
BEFORE UPDATE OR DELETE ON map_recovery_contracts
FOR EACH ROW EXECUTE FUNCTION reject_map_recovery_contract_mutation();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('416', 'Harden production routing authority anchors', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
