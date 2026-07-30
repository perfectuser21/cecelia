-- Migration 374: immutable, real-execution-backed Golden Path assertion receipts.
-- Receipts add verification evidence without changing the cell ledger structure.

ALTER TABLE journey_step_links
  ADD COLUMN IF NOT EXISTS assertion_revision BIGINT NOT NULL DEFAULT 1
    CHECK (assertion_revision > 0);

CREATE OR REPLACE FUNCTION bump_journey_assertion_revision()
RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.assertion_ref, NEW.cell_key, NEW.feature_id, NEW.na_reason)
     IS DISTINCT FROM
     ROW(OLD.assertion_ref, OLD.cell_key, OLD.feature_id, OLD.na_reason) THEN
    NEW.assertion_revision := OLD.assertion_revision + 1;
  ELSE
    NEW.assertion_revision := OLD.assertion_revision;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bump_journey_assertion_revision
  ON journey_step_links;
CREATE TRIGGER trg_bump_journey_assertion_revision
  BEFORE UPDATE ON journey_step_links
  FOR EACH ROW EXECUTE FUNCTION bump_journey_assertion_revision();

CREATE TABLE IF NOT EXISTS journey_assertion_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_step_link_id UUID NOT NULL
    REFERENCES journey_step_links(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL CHECK (btrim(run_id) <> ''),
  assertion_revision BIGINT NOT NULL CHECK (assertion_revision > 0),
  assertion_ref_snapshot TEXT NOT NULL
    CHECK (btrim(assertion_ref_snapshot) <> ''),
  assertion_digest TEXT NOT NULL
    CHECK (assertion_digest ~ '^[0-9a-f]{64}$'),
  source_repo TEXT NOT NULL CHECK (btrim(source_repo) <> ''),
  source_sha TEXT,
  gp_contract_id UUID
    REFERENCES golden_path_contract_versions(id) ON DELETE RESTRICT,
  gp_contract_hash TEXT,
  command_argv JSONB NOT NULL
    CHECK (
      jsonb_typeof(command_argv) = 'array'
      AND jsonb_array_length(command_argv) > 0
    ),
  scenario_count INTEGER NOT NULL DEFAULT 0
    CHECK (scenario_count >= 0),
  scenario_evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(scenario_evidence) = 'object'),
  verdict TEXT NOT NULL CHECK (verdict IN ('PASS', 'FAIL')),
  exit_code INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  machine_id TEXT,
  output_digest TEXT,
  output_tail TEXT NOT NULL DEFAULT '',
  executor_kind TEXT NOT NULL DEFAULT 'brain_assertion_runner'
    CHECK (executor_kind = 'brain_assertion_runner'),
  synthetic BOOLEAN NOT NULL DEFAULT false CHECK (synthetic = false),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, journey_step_link_id),
  CONSTRAINT journey_assertion_receipt_interval_chk
    CHECK (completed_at >= started_at),
  CONSTRAINT journey_assertion_receipt_contract_chk
    CHECK (
      (gp_contract_id IS NULL AND gp_contract_hash IS NULL)
      OR (
        gp_contract_id IS NOT NULL
        AND gp_contract_hash IS NOT NULL
        AND gp_contract_hash ~ '^[0-9a-f]{64}$'
      )
    ),
  CONSTRAINT journey_assertion_receipt_verdict_chk
    CHECK (
      (
        verdict = 'PASS'
        AND exit_code = 0
        AND source_sha IS NOT NULL
        AND source_sha ~ '^[0-9a-f]{40}$'
        AND machine_id IS NOT NULL
        AND btrim(machine_id) <> ''
        AND output_digest IS NOT NULL
        AND output_digest ~ '^[0-9a-f]{64}$'
        AND scenario_count > 0
        AND scenario_evidence <> '{}'::jsonb
      )
      OR (verdict = 'FAIL' AND exit_code <> 0)
    )
);

-- Reruns upgrade earlier v374; legacy PASS remains unverified audit history.
ALTER TABLE journey_assertion_receipts
  ADD COLUMN IF NOT EXISTS scenario_count INTEGER NOT NULL DEFAULT 0
    CHECK (scenario_count >= 0);
ALTER TABLE journey_assertion_receipts
  ADD COLUMN IF NOT EXISTS scenario_evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(scenario_evidence) = 'object');
ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipt_verdict_chk;
ALTER TABLE journey_assertion_receipts
  ADD CONSTRAINT journey_assertion_receipt_verdict_chk
  CHECK (
    (
      verdict = 'PASS'
      AND exit_code = 0
      AND source_sha IS NOT NULL
      AND source_sha ~ '^[0-9a-f]{40}$'
      AND machine_id IS NOT NULL
      AND btrim(machine_id) <> ''
      AND output_digest IS NOT NULL
      AND output_digest ~ '^[0-9a-f]{64}$'
      AND scenario_count > 0
      AND scenario_evidence <> '{}'::jsonb
    )
    OR (verdict = 'FAIL' AND exit_code <> 0)
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_journey_assertion_receipts_cell_current
  ON journey_assertion_receipts (
    journey_step_link_id,
    assertion_revision,
    assertion_digest,
    completed_at DESC,
    created_at DESC
  );

CREATE OR REPLACE FUNCTION prevent_journey_assertion_receipt_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'journey_assertion_receipts is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journey_assertion_receipts_append_only
  ON journey_assertion_receipts;
CREATE TRIGGER trg_journey_assertion_receipts_append_only
  BEFORE UPDATE OR DELETE ON journey_assertion_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_journey_assertion_receipt_mutation();

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '374',
  'Immutable real-execution Golden Path assertion receipts',
  NOW()
)
ON CONFLICT (version) DO NOTHING;
