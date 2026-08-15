-- Bind exactly one new Kernel run to one immutable Planner recovery receipt.

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS planner_recovery_receipt_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='initiative_runs'::regclass
       AND conname='initiative_runs_planner_recovery_receipt_fk'
  ) THEN
    ALTER TABLE initiative_runs
      ADD CONSTRAINT initiative_runs_planner_recovery_receipt_fk
      FOREIGN KEY (planner_recovery_receipt_id)
      REFERENCES planner_recovery_receipts(id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='initiative_runs'::regclass
       AND conname='initiative_runs_planner_recovery_receipt_unique'
  ) THEN
    ALTER TABLE initiative_runs
      ADD CONSTRAINT initiative_runs_planner_recovery_receipt_unique
      UNIQUE (planner_recovery_receipt_id);
  END IF;
END
$$;

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
      'planner_recovery',
      'historical_reconstruction'
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION enforce_planner_recovery_run_authority()
RETURNS TRIGGER AS $$
DECLARE
  authority RECORD;
BEGIN
  IF (NEW.created_source IS NOT DISTINCT FROM 'planner_recovery')
       IS DISTINCT FROM (NEW.planner_recovery_receipt_id IS NOT NULL) THEN
    RAISE EXCEPTION 'planner_recovery_run_authority_invalid'
      USING ERRCODE='23514';
  END IF;

  IF NEW.planner_recovery_receipt_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT receipt.predecessor_run_id,
         receipt.source_task_id,
         consumption.successor_task_id,
         predecessor.initiative_id,
         predecessor.current_task_id AS predecessor_task_id,
         predecessor.phase AS predecessor_phase,
         predecessor.orchestrator_version,
         predecessor.record_trust_status,
         source_task.status AS source_task_status
    INTO authority
    FROM planner_recovery_receipts receipt
    JOIN planner_recovery_consumptions consumption
      ON consumption.receipt_id=receipt.id
    JOIN initiative_runs predecessor
      ON predecessor.id=receipt.predecessor_run_id
    JOIN tasks source_task
      ON source_task.id=receipt.source_task_id
   WHERE receipt.id=NEW.planner_recovery_receipt_id;

  IF NEW.created_source IS DISTINCT FROM 'planner_recovery'
     OR NEW.phase IS DISTINCT FROM 'gan'
     OR NEW.predecessor_run_id IS NULL
     OR NEW.contract_id IS NOT NULL
     OR NEW.pr_url IS NOT NULL
     OR NEW.orchestrator_version IS DISTINCT FROM 'v2'
     OR NEW.record_trust_status IS DISTINCT FROM 'trusted'
     OR NOT FOUND
     OR authority.predecessor_run_id IS DISTINCT FROM NEW.predecessor_run_id
     OR authority.successor_task_id IS DISTINCT FROM NEW.current_task_id
     OR authority.source_task_id IS DISTINCT FROM authority.predecessor_task_id
     OR authority.initiative_id IS DISTINCT FROM NEW.initiative_id
     OR authority.predecessor_phase IS DISTINCT FROM 'failed'
     OR authority.orchestrator_version IS DISTINCT FROM 'v2'
     OR authority.record_trust_status IS DISTINCT FROM 'trusted'
     OR authority.source_task_status IS DISTINCT FROM 'failed'
  THEN
    RAISE EXCEPTION 'planner_recovery_run_authority_invalid'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planner_recovery_run_authority ON initiative_runs;
CREATE TRIGGER planner_recovery_run_authority
BEFORE INSERT ON initiative_runs
FOR EACH ROW EXECUTE FUNCTION enforce_planner_recovery_run_authority();

CREATE OR REPLACE FUNCTION reject_planner_recovery_run_binding_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.planner_recovery_receipt_id IS DISTINCT FROM OLD.planner_recovery_receipt_id
     OR (
       OLD.planner_recovery_receipt_id IS NULL
       AND NEW.created_source IS DISTINCT FROM OLD.created_source
       AND NEW.created_source = 'planner_recovery'
     )
     OR (
       OLD.planner_recovery_receipt_id IS NOT NULL
       AND (
         NEW.created_source IS DISTINCT FROM OLD.created_source
         OR NEW.initiative_id IS DISTINCT FROM OLD.initiative_id
         OR NEW.predecessor_run_id IS DISTINCT FROM OLD.predecessor_run_id
         OR NEW.current_task_id IS DISTINCT FROM OLD.current_task_id
         OR NEW.orchestrator_version IS DISTINCT FROM OLD.orchestrator_version
         OR NEW.record_trust_status IS DISTINCT FROM OLD.record_trust_status
       )
     )
  THEN
    RAISE EXCEPTION 'planner_recovery_run_binding_immutable'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planner_recovery_run_binding_immutable ON initiative_runs;
CREATE TRIGGER planner_recovery_run_binding_immutable
BEFORE UPDATE OF planner_recovery_receipt_id,created_source,initiative_id,
  predecessor_run_id,current_task_id,orchestrator_version,record_trust_status
ON initiative_runs
FOR EACH ROW EXECUTE FUNCTION reject_planner_recovery_run_binding_mutation();

INSERT INTO schema_version(version,description,applied_at)
VALUES ('430','Immutable Planner recovery receipt to Kernel run binding',NOW())
ON CONFLICT (version) DO NOTHING;
