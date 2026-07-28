-- Migration 374: durable exact-SHA Kernel ReleaseRun authority.
--
-- A confirmed Kernel merge receipt may create one immutable ReleaseRun. The
-- state ledger and effect ledgers are append-only. Staging and production
-- effects are separately receipted but serialized by the runtime's one
-- release advisory lease.

CREATE TABLE IF NOT EXISTS kernel_release_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL UNIQUE REFERENCES initiative_runs(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  merge_intent_id UUID NOT NULL UNIQUE REFERENCES kernel_merge_effect_intents(id),
  merge_receipt_id UUID NOT NULL UNIQUE REFERENCES kernel_merge_effect_receipts(id),
  repository TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  source_head_sha TEXT NOT NULL CHECK (
    char_length(source_head_sha) = 40
    AND source_head_sha = lower(source_head_sha)
    AND source_head_sha ~ '^[0-9a-f]+$'
  ),
  merge_sha TEXT NOT NULL CHECK (
    char_length(merge_sha) = 40
    AND merge_sha = lower(merge_sha)
    AND merge_sha ~ '^[0-9a-f]+$'
  ),
  artifact_versions JSONB NOT NULL CHECK (
    jsonb_typeof(artifact_versions) = 'array'
    AND jsonb_array_length(artifact_versions) > 0
  ),
  policy_version TEXT NOT NULL CHECK (policy_version = 'kernel-release/v1'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kernel_release_runs_task
  ON kernel_release_runs (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kernel_release_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  append_seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  release_run_id UUID NOT NULL REFERENCES kernel_release_runs(id),
  state TEXT NOT NULL CHECK (state IN (
    'merged',
    'staging_queued',
    'staging_running',
    'staging_passed',
    'production_deploying',
    'production_verified'
  )),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (release_run_id, state)
);

CREATE INDEX IF NOT EXISTS idx_kernel_release_transitions_current
  ON kernel_release_transitions (release_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kernel_release_effect_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_run_id UUID NOT NULL REFERENCES kernel_release_runs(id),
  effect_kind TEXT NOT NULL CHECK (effect_kind IN ('staging', 'production')),
  idempotency_key UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expected_merge_sha TEXT NOT NULL CHECK (
    char_length(expected_merge_sha) = 40
    AND expected_merge_sha = lower(expected_merge_sha)
    AND expected_merge_sha ~ '^[0-9a-f]+$'
  ),
  expected_artifact_versions JSONB NOT NULL CHECK (
    jsonb_typeof(expected_artifact_versions) = 'array'
    AND jsonb_array_length(expected_artifact_versions) > 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (release_run_id, effect_kind)
);

CREATE TABLE IF NOT EXISTS kernel_release_effect_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  append_seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  intent_id UUID NOT NULL REFERENCES kernel_release_effect_intents(id),
  receipt_status TEXT NOT NULL CHECK (
    receipt_status IN ('confirmed', 'failed', 'observed_unconfirmed')
  ),
  observed_merge_sha TEXT CHECK (
    observed_merge_sha IS NULL OR (
      char_length(observed_merge_sha) = 40
      AND observed_merge_sha = lower(observed_merge_sha)
      AND observed_merge_sha ~ '^[0-9a-f]+$'
    )
  ),
  observed_artifact_versions JSONB,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kernel_release_effect_receipts_intent
  ON kernel_release_effect_receipts (intent_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_release_effect_confirmed
  ON kernel_release_effect_receipts (intent_id)
  WHERE receipt_status = 'confirmed';

CREATE TABLE IF NOT EXISTS kernel_release_effect_dispatch_claims (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent_id UUID NOT NULL REFERENCES kernel_release_effect_intents(id),
  generation INTEGER NOT NULL CHECK (generation > 0),
  idempotency_key UUID NOT NULL,
  effect_kind TEXT NOT NULL CHECK (effect_kind IN ('staging', 'production')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (intent_id, generation)
);

CREATE TABLE IF NOT EXISTS kernel_release_effect_dispatch_outcomes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispatch_claim_id BIGINT NOT NULL REFERENCES kernel_release_effect_dispatch_claims(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('dispatched', 'failed')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION kernel_release_transition_guard()
RETURNS trigger AS $$
DECLARE
  previous_state TEXT;
  expected_state TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.release_run_id::text, 0));

  SELECT state
    INTO previous_state
    FROM kernel_release_transitions
   WHERE release_run_id = NEW.release_run_id
   ORDER BY append_seq DESC
   LIMIT 1;

  expected_state := CASE
    WHEN previous_state IS NULL THEN 'merged'
    WHEN previous_state = 'merged' THEN 'staging_queued'
    WHEN previous_state = 'staging_queued' THEN 'staging_running'
    WHEN previous_state = 'staging_running' THEN 'staging_passed'
    WHEN previous_state = 'staging_passed' THEN 'production_deploying'
    WHEN previous_state = 'production_deploying' THEN 'production_verified'
    ELSE NULL
  END;

  IF NEW.state IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION
      'invalid kernel release transition: % -> % (expected %)',
      COALESCE(previous_state, '<none>'), NEW.state, COALESCE(expected_state, '<terminal>');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_transition_guard
  ON kernel_release_transitions;
CREATE TRIGGER trg_kernel_release_transition_guard
  BEFORE INSERT ON kernel_release_transitions
  FOR EACH ROW EXECUTE FUNCTION kernel_release_transition_guard();

CREATE OR REPLACE FUNCTION kernel_release_ledger_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'kernel release ledger is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_runs_append_only ON kernel_release_runs;
CREATE TRIGGER trg_kernel_release_runs_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_runs
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_transitions_append_only ON kernel_release_transitions;
CREATE TRIGGER trg_kernel_release_transitions_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_transitions
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_effect_intents_append_only ON kernel_release_effect_intents;
CREATE TRIGGER trg_kernel_release_effect_intents_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_effect_intents
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_effect_receipts_append_only ON kernel_release_effect_receipts;
CREATE TRIGGER trg_kernel_release_effect_receipts_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_effect_dispatch_claims_append_only
  ON kernel_release_effect_dispatch_claims;
CREATE TRIGGER trg_kernel_release_effect_dispatch_claims_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_effect_dispatch_claims
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_effect_dispatch_outcomes_append_only
  ON kernel_release_effect_dispatch_outcomes;
CREATE TRIGGER trg_kernel_release_effect_dispatch_outcomes_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_effect_dispatch_outcomes
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('374', 'Kernel ReleaseRun exact-SHA authority and receipts', NOW())
ON CONFLICT (version) DO NOTHING;
