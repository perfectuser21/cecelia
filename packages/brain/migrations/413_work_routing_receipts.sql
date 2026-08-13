-- Migration 413: production authority anchor for immutable routing receipts.
-- Production already recorded this version before the original branch closed;
-- keep this migration one-version/one-meaning and apply later hardening in 416.

CREATE TABLE IF NOT EXISTS work_routing_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
  source text NOT NULL,
  source_id text NOT NULL,
  work_kind text NOT NULL,
  change_kind text,
  pipeline text NOT NULL,
  canonical_task_type text NOT NULL,
  default_execution_profile text,
  execution_profile_override text,
  repo text,
  map_scope jsonb NOT NULL DEFAULT '[]',
  impact_contract_required boolean NOT NULL DEFAULT false,
  orchestrator text NOT NULL,
  router_version text NOT NULL,
  route_reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  supersedes_receipt_id uuid REFERENCES work_routing_receipts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source, source_id, router_version)
);

CREATE OR REPLACE FUNCTION reject_work_routing_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'work_routing_receipts_append_only';
END
$$;

DROP TRIGGER IF EXISTS work_routing_receipts_immutable ON work_routing_receipts;
CREATE TRIGGER work_routing_receipts_immutable
BEFORE UPDATE OR DELETE ON work_routing_receipts
FOR EACH ROW EXECUTE FUNCTION reject_work_routing_receipt_mutation();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('413', 'work_routing_receipts production authority anchor', NOW())
ON CONFLICT (version) DO NOTHING;
