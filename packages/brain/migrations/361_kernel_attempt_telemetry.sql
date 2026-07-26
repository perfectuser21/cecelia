-- Migration 361: provider-neutral Kernel attempt telemetry.
-- Additive only. Existing attempt rows retain conservative initial/ws1 defaults.

ALTER TABLE harness_attempts
  ADD COLUMN IF NOT EXISTS logical_cycle_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_kind TEXT NOT NULL DEFAULT 'initial'
    CHECK (attempt_kind IN ('initial','fix','retry','resume','recovery')),
  ADD COLUMN IF NOT EXISTS retry_of_attempt_id UUID REFERENCES harness_attempts(id),
  ADD COLUMN IF NOT EXISTS restart_reason TEXT,
  ADD COLUMN IF NOT EXISTS workstream_key TEXT NOT NULL DEFAULT 'ws1',
  ADD COLUMN IF NOT EXISTS time_derived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_harness_attempts_logical_cycle
  ON harness_attempts (run_id, logical_cycle_id);

CREATE INDEX IF NOT EXISTS idx_harness_attempts_retry_lineage
  ON harness_attempts (retry_of_attempt_id)
  WHERE retry_of_attempt_id IS NOT NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('361', 'Kernel attempt lineage and telemetry fields', NOW())
ON CONFLICT (version) DO NOTHING;
