BEGIN;

CREATE OR REPLACE FUNCTION reject_work_routing_task_projection_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  receipt work_routing_receipts%ROWTYPE;
BEGIN
  SELECT * INTO receipt
    FROM work_routing_receipts
   WHERE task_id = OLD.id
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.task_type IS DISTINCT FROM receipt.canonical_task_type
     OR NEW.payload->>'routing_receipt_id' IS DISTINCT FROM receipt.id::text
     OR NEW.payload->>'work_kind' IS DISTINCT FROM receipt.work_kind
     OR NEW.payload->>'change_kind' IS DISTINCT FROM receipt.change_kind
     OR NEW.payload->>'default_execution_profile'
          IS DISTINCT FROM receipt.default_execution_profile
     OR NEW.payload->>'execution_profile_override'
          IS DISTINCT FROM receipt.execution_profile_override
     OR NEW.payload->>'repo' IS DISTINCT FROM receipt.repo
     OR NEW.payload->'map_scope' IS DISTINCT FROM receipt.map_scope
     OR COALESCE((NEW.payload->>'impact_contract_required')::boolean, false)
          IS DISTINCT FROM receipt.impact_contract_required
     OR (
       receipt.pipeline = 'harness'
       AND (
         NEW.payload->>'harness_runtime' IS DISTINCT FROM 'kernel-v1'
         OR NEW.payload->>'orchestrator' IS DISTINCT FROM 'skill-relay'
       )
     ) THEN
    RAISE EXCEPTION 'work_routing_task_projection_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_routing_task_projection_immutable ON tasks;
CREATE TRIGGER work_routing_task_projection_immutable
BEFORE UPDATE OF task_type, payload ON tasks
FOR EACH ROW EXECUTE FUNCTION reject_work_routing_task_projection_mutation();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('417', 'Protect task projections of immutable Work Routing Receipts', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
