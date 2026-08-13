CREATE TABLE IF NOT EXISTS work_routing_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES tasks(id),
  source text NOT NULL, source_id text NOT NULL, work_kind text NOT NULL, change_kind text,
  pipeline text NOT NULL, canonical_task_type text NOT NULL, default_execution_profile text,
  execution_profile_override text, repo text, map_scope jsonb NOT NULL DEFAULT '[]',
  impact_contract_required boolean NOT NULL DEFAULT false, orchestrator text NOT NULL,
  router_version text NOT NULL, route_reason text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}',
  supersedes_receipt_id uuid REFERENCES work_routing_receipts(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source, source_id, router_version)
);
CREATE INDEX IF NOT EXISTS idx_work_routing_receipts_task_created
  ON work_routing_receipts(task_id, created_at DESC);
CREATE TABLE IF NOT EXISTS map_recovery_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid NOT NULL REFERENCES work_routing_receipts(id),
  task_id uuid NOT NULL REFERENCES tasks(id), repo text NOT NULL, branch text NOT NULL, base_sha text NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('map_unavailable','scanner_unavailable','projection_unavailable')),
  expires_at timestamptz NOT NULL, authorization_evidence jsonb NOT NULL,
  attempt_id uuid UNIQUE REFERENCES harness_attempts(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(receipt_id, attempt_id)
);
CREATE OR REPLACE FUNCTION reject_map_recovery_contract_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'map_recovery_contracts_append_only'; END $$;
DROP TRIGGER IF EXISTS map_recovery_contracts_immutable ON map_recovery_contracts;
CREATE TRIGGER map_recovery_contracts_immutable BEFORE UPDATE OR DELETE ON map_recovery_contracts FOR EACH ROW EXECUTE FUNCTION reject_map_recovery_contract_mutation();
CREATE OR REPLACE FUNCTION reject_work_routing_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'work_routing_receipts_append_only'; END $$;
DROP TRIGGER IF EXISTS work_routing_receipts_immutable ON work_routing_receipts;
CREATE TRIGGER work_routing_receipts_immutable BEFORE UPDATE OR DELETE ON work_routing_receipts FOR EACH ROW EXECUTE FUNCTION reject_work_routing_receipt_mutation();
