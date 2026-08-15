-- One immutable consumption of one exact Planner recovery receipt.

CREATE TABLE IF NOT EXISTS planner_recovery_consumptions (
  receipt_id UUID PRIMARY KEY
    REFERENCES planner_recovery_receipts(id) ON DELETE RESTRICT,
  successor_task_id UUID NOT NULL UNIQUE
    REFERENCES tasks(id) ON DELETE RESTRICT,
  routing_receipt_id UUID NOT NULL UNIQUE,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT planner_recovery_consumptions_idempotency_key_check
    CHECK (
      idempotency_key IS NULL
      OR idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
  CONSTRAINT planner_recovery_consumptions_routing_task_fk
    FOREIGN KEY (routing_receipt_id, successor_task_id)
    REFERENCES work_routing_receipts(id, task_id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION enforce_planner_recovery_consumption_authority()
RETURNS TRIGGER AS $$
DECLARE
  authority RECORD;
BEGIN
  SELECT recovery.predecessor_run_id,
         recovery.source_task_id,
         recovery.verification_method,
         run.phase AS run_phase,
         run.orchestrator_version,
         run.record_trust_status,
         source_task.status AS source_task_status,
         successor.payload AS successor_payload,
         route.source AS route_source,
         route.source_id AS route_source_id
    INTO authority
    FROM planner_recovery_receipts recovery
    JOIN initiative_runs run ON run.id = recovery.predecessor_run_id
    JOIN tasks source_task ON source_task.id = recovery.source_task_id
    JOIN tasks successor ON successor.id = NEW.successor_task_id
    JOIN work_routing_receipts route
      ON route.id = NEW.routing_receipt_id
     AND route.task_id = NEW.successor_task_id
   WHERE recovery.id = NEW.receipt_id;

  IF NOT FOUND
     OR authority.verification_method IS DISTINCT FROM 'remote_exact_commit_blob'
     OR authority.run_phase IS DISTINCT FROM 'failed'
     OR authority.orchestrator_version IS DISTINCT FROM 'v2'
     OR authority.record_trust_status IS DISTINCT FROM 'trusted'
     OR authority.source_task_status IS DISTINCT FROM 'failed'
     OR authority.successor_payload->>'planner_recovery_receipt_id'
          IS DISTINCT FROM NEW.receipt_id::text
     OR authority.route_source IS DISTINCT FROM 'child'
     OR authority.route_source_id IS DISTINCT FROM CONCAT('planner-recovery:', NEW.receipt_id::text)
  THEN
    RAISE EXCEPTION 'planner_recovery_consumption_authority_invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planner_recovery_consumptions_authority
  ON planner_recovery_consumptions;
CREATE TRIGGER planner_recovery_consumptions_authority
BEFORE INSERT ON planner_recovery_consumptions
FOR EACH ROW EXECUTE FUNCTION enforce_planner_recovery_consumption_authority();

CREATE OR REPLACE FUNCTION reject_planner_recovery_consumption_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'planner_recovery_consumptions_append_only'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planner_recovery_consumptions_immutable
  ON planner_recovery_consumptions;
CREATE TRIGGER planner_recovery_consumptions_immutable
BEFORE UPDATE OR DELETE ON planner_recovery_consumptions
FOR EACH ROW EXECUTE FUNCTION reject_planner_recovery_consumption_mutation();

INSERT INTO schema_version(version, description, applied_at)
VALUES ('429', 'Immutable Planner recovery receipt consumptions', NOW())
ON CONFLICT (version) DO NOTHING;
