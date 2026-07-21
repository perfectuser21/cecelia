-- Migration 357: provider-neutral Harness execution attempts.
-- Additive only. Existing skill-relay/controller runs are unaffected.

CREATE TABLE IF NOT EXISTS harness_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE CASCADE,
  hop INT NOT NULL CHECK (hop >= 1),
  phase TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('planner','proposer','reviewer','generator','evaluator','judge','reporter')),
  provider TEXT NOT NULL DEFAULT 'auto',
  account_id TEXT,
  machine_id TEXT,
  skill_name TEXT,
  skill_version TEXT,
  skill_digest TEXT,
  task_bundle JSONB NOT NULL,
  result JSONB,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued','starting','running','completed','completed_with_concerns',
      'needs_context','blocked','failed','cancelled'
    )),
  provider_session_id TEXT,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_harness_attempts_run_hop UNIQUE (run_id, hop)
);

CREATE INDEX IF NOT EXISTS idx_harness_attempts_active_lease
  ON harness_attempts (lease_expires_at)
  WHERE status IN ('queued','starting','running');

-- One provider session belongs to exactly one attempt inside a run.
-- This makes cross-role/cross-attempt resume races fail atomically in PostgreSQL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_harness_attempts_provider_session
  ON harness_attempts (run_id, provider, provider_session_id)
  WHERE provider_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_harness_attempts_run_created
  ON harness_attempts (run_id, created_at DESC);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('357', 'Provider-neutral Harness execution attempts', NOW())
ON CONFLICT (version) DO NOTHING;
