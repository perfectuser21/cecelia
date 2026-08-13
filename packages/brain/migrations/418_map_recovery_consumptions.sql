DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='work_routing_receipts'::regclass
       AND conname='work_routing_receipts_id_task_unique'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_id_task_unique UNIQUE (id, task_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='map_recovery_contracts'::regclass
       AND conname='map_recovery_contracts_receipt_unique'
  ) THEN
    ALTER TABLE map_recovery_contracts
      ADD CONSTRAINT map_recovery_contracts_receipt_unique UNIQUE (receipt_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='map_recovery_contracts'::regclass
       AND conname='map_recovery_contracts_receipt_task_fk'
  ) THEN
    ALTER TABLE map_recovery_contracts
      ADD CONSTRAINT map_recovery_contracts_receipt_task_fk
      FOREIGN KEY (receipt_id, task_id)
      REFERENCES work_routing_receipts(id, task_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='map_recovery_contracts'::regclass
       AND conname='map_recovery_contracts_base_sha_check'
  ) THEN
    ALTER TABLE map_recovery_contracts
      ADD CONSTRAINT map_recovery_contracts_base_sha_check
      CHECK (base_sha ~ '^[0-9a-f]{40}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='map_recovery_contracts'::regclass
       AND conname='map_recovery_contracts_authority_check'
  ) THEN
    ALTER TABLE map_recovery_contracts
      ADD CONSTRAINT map_recovery_contracts_authority_check
      CHECK (
        jsonb_typeof(authorization_evidence) = 'object'
        AND authorization_evidence ? 'authorized_by'
        AND authorization_evidence ? 'observed_reason_code'
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS map_recovery_consumptions (
  contract_id uuid PRIMARY KEY REFERENCES map_recovery_contracts(id),
  attempt_id uuid NOT NULL UNIQUE REFERENCES harness_attempts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_map_recovery_consumption_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'map_recovery_consumptions_append_only';
END
$$;

DROP TRIGGER IF EXISTS map_recovery_consumptions_immutable
  ON map_recovery_consumptions;
CREATE TRIGGER map_recovery_consumptions_immutable
  BEFORE UPDATE OR DELETE ON map_recovery_consumptions
  FOR EACH ROW EXECUTE FUNCTION reject_map_recovery_consumption_mutation();

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS map_recovery_contract_id UUID
    REFERENCES map_recovery_contracts(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_initiative_runs_map_recovery_contract
  ON initiative_runs(map_recovery_contract_id)
  WHERE map_recovery_contract_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_run_recovery_contract_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.map_recovery_contract_id IS DISTINCT FROM OLD.map_recovery_contract_id THEN
    RAISE EXCEPTION 'initiative run map recovery contract is immutable';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_prevent_run_recovery_contract_mutation
  ON initiative_runs;
CREATE TRIGGER trg_prevent_run_recovery_contract_mutation
  BEFORE UPDATE OF map_recovery_contract_id ON initiative_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_run_recovery_contract_mutation();

INSERT INTO schema_version (version, description)
VALUES (418, 'append-only map recovery consumption')
ON CONFLICT DO NOTHING;
