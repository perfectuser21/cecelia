-- Migration 375: reconcile installed ReleaseRun v374 with fenced closure.
--
-- Migration 374 shipped before the complete fencing and evidence schema. This
-- migration is intentionally safe after both the original and hardened v374:
-- it adds missing columns/tables and replaces all guards with the exact form.
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

CREATE OR REPLACE FUNCTION kernel_release_run_identity_guard()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM kernel_merge_effect_intents intent
      JOIN kernel_merge_authorizations auth
        ON auth.id = intent.authorization_id
       AND auth.run_id = intent.run_id
      JOIN kernel_merge_effect_receipts receipt
        ON receipt.intent_id = intent.id
       AND receipt.receipt_status = 'confirmed'
       AND receipt.merged = TRUE
       AND receipt.observed_head_sha = intent.requested_head_sha
     WHERE intent.id = NEW.merge_intent_id
       AND receipt.id = NEW.merge_receipt_id
       AND auth.run_id = NEW.run_id
       AND auth.task_id = NEW.task_id
       AND auth.repository = NEW.repository
       AND auth.pr_number = NEW.pr_number
       AND auth.head_sha = NEW.source_head_sha
       AND intent.requested_head_sha = NEW.source_head_sha
       AND receipt.evidence->>'merge_commit_sha' = NEW.merge_sha
  ) THEN
    RAISE EXCEPTION
      'release identity requires one exact confirmed merge intent/receipt pair';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_run_identity_guard
  ON kernel_release_runs;
CREATE TRIGGER trg_kernel_release_run_identity_guard
  BEFORE INSERT ON kernel_release_runs
  FOR EACH ROW EXECUTE FUNCTION kernel_release_run_identity_guard();

CREATE TABLE IF NOT EXISTS kernel_release_e2e_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_run_id UUID NOT NULL UNIQUE REFERENCES kernel_release_runs(id),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  repository TEXT NOT NULL CHECK (
    repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  ),
  contract_id UUID NOT NULL REFERENCES initiative_contracts(id),
  merge_sha TEXT NOT NULL CHECK (merge_sha ~ '^[0-9a-f]{40}$'),
  artifact_versions JSONB NOT NULL CHECK (
    jsonb_typeof(artifact_versions) = 'array'
    AND jsonb_array_length(artifact_versions) > 0
  ),
  artifact_set_digest TEXT NOT NULL CHECK (
    artifact_set_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  contract_version INTEGER NOT NULL CHECK (contract_version > 0),
  contract_approved_at TIMESTAMPTZ NOT NULL,
  contract_content TEXT NOT NULL CHECK (contract_content <> ''),
  contract_digest TEXT NOT NULL CHECK (
    contract_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  policy_version TEXT NOT NULL CHECK (policy_version = 'kernel-release-e2e/v1'),
  e2e_acceptance JSONB NOT NULL CHECK (
    jsonb_typeof(e2e_acceptance) = 'object'
    AND jsonb_typeof(e2e_acceptance->'scenarios') = 'array'
    AND jsonb_array_length(e2e_acceptance->'scenarios') > 0
  ),
  e2e_acceptance_digest TEXT NOT NULL CHECK (
    e2e_acceptance_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  scenarios_total INTEGER NOT NULL CHECK (
    scenarios_total > 0
    AND scenarios_total = jsonb_array_length(e2e_acceptance->'scenarios')
  ),
  manifest_digest TEXT NOT NULL UNIQUE CHECK (
    manifest_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

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

-- Existing v374 dispatch claims predate claim modes. Temporarily remove the
-- append-only row trigger only for the deterministic schema backfill; the
-- hardened trigger is recreated below before this transaction commits.
DROP TRIGGER IF EXISTS trg_kernel_release_effect_dispatch_claims_append_only
  ON kernel_release_effect_dispatch_claims;
ALTER TABLE kernel_release_effect_dispatch_claims
  ADD COLUMN IF NOT EXISTS claim_mode TEXT;
UPDATE kernel_release_effect_dispatch_claims
   SET claim_mode = 'dispatch'
 WHERE claim_mode IS NULL;
ALTER TABLE kernel_release_effect_dispatch_claims
  ALTER COLUMN claim_mode SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kernel_release_effect_dispatch_claims'::regclass
       AND conname = 'kernel_release_effect_dispatch_claims_claim_mode_check'
  ) THEN
    ALTER TABLE kernel_release_effect_dispatch_claims
      ADD CONSTRAINT kernel_release_effect_dispatch_claims_claim_mode_check
      CHECK (claim_mode IN ('dispatch', 'verification'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS kernel_release_effect_dispatch_claims (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent_id UUID NOT NULL REFERENCES kernel_release_effect_intents(id),
  generation INTEGER NOT NULL CHECK (generation > 0),
  idempotency_key UUID NOT NULL,
  effect_kind TEXT NOT NULL CHECK (effect_kind IN ('staging', 'production')),
  claim_mode TEXT NOT NULL CHECK (claim_mode IN ('dispatch', 'verification')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (intent_id, generation)
);

CREATE TABLE IF NOT EXISTS kernel_release_effect_dispatch_renewals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispatch_claim_id BIGINT NOT NULL
    REFERENCES kernel_release_effect_dispatch_claims(id),
  generation INTEGER NOT NULL CHECK (generation > 0),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  renewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE kernel_release_effect_dispatch_outcomes
  DROP CONSTRAINT IF EXISTS kernel_release_effect_dispatch_outcomes_outcome_check;
ALTER TABLE kernel_release_effect_dispatch_outcomes
  ADD CONSTRAINT kernel_release_effect_dispatch_outcomes_outcome_check
  CHECK (outcome IN ('dispatched', 'failed', 'observed'));
DO $$
BEGIN
  IF EXISTS (
    SELECT dispatch_claim_id
      FROM kernel_release_effect_dispatch_outcomes
     GROUP BY dispatch_claim_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot fence ReleaseRun dispatch outcomes: duplicate claim outcomes exist';
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_release_dispatch_outcome_claim
  ON kernel_release_effect_dispatch_outcomes (dispatch_claim_id);

CREATE TABLE IF NOT EXISTS kernel_release_effect_dispatch_outcomes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispatch_claim_id BIGINT NOT NULL UNIQUE
    REFERENCES kernel_release_effect_dispatch_claims(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('dispatched', 'failed', 'observed')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE kernel_release_effect_receipts
  ADD COLUMN IF NOT EXISTS dispatch_claim_id BIGINT
    REFERENCES kernel_release_effect_dispatch_claims(id),
  ADD COLUMN IF NOT EXISTS dispatch_generation INTEGER CHECK (
    dispatch_generation IS NULL OR dispatch_generation > 0
  ),
  ADD COLUMN IF NOT EXISTS e2e_manifest_id UUID
    REFERENCES kernel_release_e2e_manifests(id),
  ADD COLUMN IF NOT EXISTS e2e_manifest_digest TEXT CHECK (
    e2e_manifest_digest IS NULL
    OR e2e_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN IF NOT EXISTS e2e_scenarios_total INTEGER CHECK (
    e2e_scenarios_total IS NULL OR e2e_scenarios_total > 0
  ),
  ADD COLUMN IF NOT EXISTS e2e_scenarios_passed INTEGER CHECK (
    e2e_scenarios_passed IS NULL OR e2e_scenarios_passed > 0
  ),
  ADD COLUMN IF NOT EXISTS e2e_environment TEXT CHECK (
    e2e_environment IS NULL OR e2e_environment IN ('staging', 'production')
  ),
  ADD COLUMN IF NOT EXISTS e2e_scenario_results JSONB CHECK (
    e2e_scenario_results IS NULL
    OR jsonb_typeof(e2e_scenario_results) = 'array'
  ),
  ADD COLUMN IF NOT EXISTS e2e_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS e2e_finished_at TIMESTAMPTZ CHECK (
    e2e_finished_at IS NULL OR e2e_started_at IS NULL
    OR e2e_finished_at >= e2e_started_at
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
  dispatch_claim_id BIGINT
    REFERENCES kernel_release_effect_dispatch_claims(id),
  dispatch_generation INTEGER CHECK (
    dispatch_generation IS NULL OR dispatch_generation > 0
  ),
  e2e_manifest_id UUID REFERENCES kernel_release_e2e_manifests(id),
  e2e_manifest_digest TEXT CHECK (
    e2e_manifest_digest IS NULL
    OR e2e_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  e2e_scenarios_total INTEGER CHECK (
    e2e_scenarios_total IS NULL OR e2e_scenarios_total > 0
  ),
  e2e_scenarios_passed INTEGER CHECK (
    e2e_scenarios_passed IS NULL OR e2e_scenarios_passed > 0
  ),
  e2e_environment TEXT CHECK (
    e2e_environment IS NULL OR e2e_environment IN ('staging', 'production')
  ),
  e2e_scenario_results JSONB CHECK (
    e2e_scenario_results IS NULL OR jsonb_typeof(e2e_scenario_results) = 'array'
  ),
  e2e_started_at TIMESTAMPTZ,
  e2e_finished_at TIMESTAMPTZ CHECK (
    e2e_finished_at IS NULL OR e2e_started_at IS NULL
    OR e2e_finished_at >= e2e_started_at
  ),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kernel_release_effect_receipts_intent
  ON kernel_release_effect_receipts (intent_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_release_effect_confirmed
  ON kernel_release_effect_receipts (intent_id)
  WHERE receipt_status = 'confirmed';

CREATE TABLE IF NOT EXISTS kernel_release_rollback_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_run_id UUID NOT NULL UNIQUE REFERENCES kernel_release_runs(id),
  expected_merge_sha TEXT NOT NULL CHECK (
    expected_merge_sha ~ '^[0-9a-f]{40}$'
  ),
  expected_artifact_versions JSONB NOT NULL CHECK (
    jsonb_typeof(expected_artifact_versions) = 'array'
    AND jsonb_array_length(expected_artifact_versions) > 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS kernel_release_rollback_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rollback_intent_id UUID NOT NULL UNIQUE
    REFERENCES kernel_release_rollback_intents(id),
  effect_receipt_id UUID NOT NULL UNIQUE
    REFERENCES kernel_release_effect_receipts(id),
  anchor TEXT NOT NULL CHECK (anchor <> ''),
  previous_version TEXT NOT NULL CHECK (previous_version <> ''),
  rollback_metadata JSONB NOT NULL CHECK (
    jsonb_typeof(rollback_metadata) = 'object'
  ),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS kernel_release_blocked_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  release_run_id UUID REFERENCES kernel_release_runs(id),
  release_state TEXT,
  merge_sha TEXT CHECK (
    merge_sha IS NULL OR merge_sha ~ '^[0-9a-f]{40}$'
  ),
  severity TEXT NOT NULL CHECK (severity = 'P0'),
  detail TEXT NOT NULL CHECK (detail <> ''),
  dedup_key TEXT NOT NULL UNIQUE CHECK (
    dedup_key ~ '^[0-9a-f]{64}$'
  ),
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- One-time N-1 cutover authority. This is deliberately isomorphic with the
-- normal ReleaseRun shape: immutable identity, ordered state, leased effect
-- attempts, and durable observations. The singleton survives terminal state,
-- permanently preventing a second bootstrap.
CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL UNIQUE DEFAULT TRUE CHECK (singleton),
  repository TEXT NOT NULL CHECK (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  source_head_sha TEXT NOT NULL CHECK (
    source_head_sha ~ '^[0-9a-f]{40}$'
  ),
  merge_sha TEXT NOT NULL CHECK (
    merge_sha ~ '^[0-9a-f]{40}$'
  ),
  approved_by TEXT NOT NULL CHECK (approved_by <> ''),
  approval_key_id TEXT NOT NULL CHECK (approval_key_id <> ''),
  approval_digest TEXT NOT NULL CHECK (
    approval_digest ~ '^[0-9a-f]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_e2e_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootstrap_run_id UUID NOT NULL UNIQUE REFERENCES kernel_release_bootstrap_runs(id),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  repository TEXT NOT NULL CHECK (
    repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  ),
  contract_id UUID NOT NULL REFERENCES initiative_contracts(id),
  merge_sha TEXT NOT NULL CHECK (merge_sha ~ '^[0-9a-f]{40}$'),
  artifact_versions JSONB NOT NULL CHECK (
    jsonb_typeof(artifact_versions) = 'array'
    AND jsonb_array_length(artifact_versions) > 0
  ),
  artifact_set_digest TEXT NOT NULL CHECK (
    artifact_set_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  contract_version INTEGER NOT NULL CHECK (contract_version > 0),
  contract_approved_at TIMESTAMPTZ NOT NULL,
  contract_content TEXT NOT NULL CHECK (contract_content <> ''),
  contract_digest TEXT NOT NULL CHECK (
    contract_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  policy_version TEXT NOT NULL CHECK (policy_version = 'kernel-release-e2e/v1'),
  e2e_acceptance JSONB NOT NULL CHECK (
    jsonb_typeof(e2e_acceptance) = 'object'
    AND jsonb_typeof(e2e_acceptance->'scenarios') = 'array'
    AND jsonb_array_length(e2e_acceptance->'scenarios') > 0
  ),
  e2e_acceptance_digest TEXT NOT NULL CHECK (
    e2e_acceptance_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  scenarios_total INTEGER NOT NULL CHECK (
    scenarios_total > 0
    AND scenarios_total = jsonb_array_length(e2e_acceptance->'scenarios')
  ),
  manifest_digest TEXT NOT NULL UNIQUE CHECK (
    manifest_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  append_seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  bootstrap_run_id UUID NOT NULL REFERENCES kernel_release_bootstrap_runs(id),
  state TEXT NOT NULL CHECK (state IN (
    'approved',
    'staging_intent',
    'staging_passed',
    'production_intent',
    'production_verified'
  )),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (bootstrap_run_id, state)
);

CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_effect_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bootstrap_run_id UUID NOT NULL REFERENCES kernel_release_bootstrap_runs(id),
  effect_kind TEXT NOT NULL CHECK (effect_kind IN ('staging', 'production')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  idempotency_key UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (bootstrap_run_id, effect_kind, generation)
);

CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_effect_attempt_renewals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  effect_attempt_id BIGINT NOT NULL
    REFERENCES kernel_release_bootstrap_effect_attempts(id),
  generation INTEGER NOT NULL CHECK (generation > 0),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  renewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_kernel_release_bootstrap_attempt_renewals
  ON kernel_release_bootstrap_effect_attempt_renewals
    (effect_attempt_id, generation, renewed_at DESC);

ALTER TABLE kernel_release_bootstrap_effect_receipts
  ADD COLUMN IF NOT EXISTS observed_merge_sha TEXT CHECK (
    observed_merge_sha IS NULL OR observed_merge_sha ~ '^[0-9a-f]{40}$'
  ),
  ADD COLUMN IF NOT EXISTS observed_artifact_versions JSONB,
  ADD COLUMN IF NOT EXISTS e2e_manifest_id UUID
    REFERENCES kernel_release_bootstrap_e2e_manifests(id),
  ADD COLUMN IF NOT EXISTS e2e_manifest_digest TEXT CHECK (
    e2e_manifest_digest IS NULL
    OR e2e_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN IF NOT EXISTS e2e_scenarios_total INTEGER CHECK (
    e2e_scenarios_total IS NULL OR e2e_scenarios_total > 0
  ),
  ADD COLUMN IF NOT EXISTS e2e_scenarios_passed INTEGER CHECK (
    e2e_scenarios_passed IS NULL OR e2e_scenarios_passed > 0
  ),
  ADD COLUMN IF NOT EXISTS e2e_environment TEXT CHECK (
    e2e_environment IS NULL OR e2e_environment IN ('staging', 'production')
  ),
  ADD COLUMN IF NOT EXISTS e2e_scenario_results JSONB CHECK (
    e2e_scenario_results IS NULL
    OR jsonb_typeof(e2e_scenario_results) = 'array'
  ),
  ADD COLUMN IF NOT EXISTS e2e_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS e2e_finished_at TIMESTAMPTZ CHECK (
    e2e_finished_at IS NULL OR e2e_started_at IS NULL
    OR e2e_finished_at >= e2e_started_at
  );

CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_effect_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  append_seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  effect_attempt_id BIGINT NOT NULL
    REFERENCES kernel_release_bootstrap_effect_attempts(id),
  receipt_status TEXT NOT NULL CHECK (
    receipt_status IN ('confirmed', 'failed', 'observed_unconfirmed')
  ),
  observed_merge_sha TEXT CHECK (
    observed_merge_sha IS NULL OR observed_merge_sha ~ '^[0-9a-f]{40}$'
  ),
  observed_artifact_versions JSONB,
  e2e_manifest_id UUID REFERENCES kernel_release_bootstrap_e2e_manifests(id),
  e2e_manifest_digest TEXT CHECK (
    e2e_manifest_digest IS NULL
    OR e2e_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  e2e_scenarios_total INTEGER CHECK (
    e2e_scenarios_total IS NULL OR e2e_scenarios_total > 0
  ),
  e2e_scenarios_passed INTEGER CHECK (
    e2e_scenarios_passed IS NULL OR e2e_scenarios_passed > 0
  ),
  e2e_environment TEXT CHECK (
    e2e_environment IS NULL OR e2e_environment IN ('staging', 'production')
  ),
  e2e_scenario_results JSONB CHECK (
    e2e_scenario_results IS NULL OR jsonb_typeof(e2e_scenario_results) = 'array'
  ),
  e2e_started_at TIMESTAMPTZ,
  e2e_finished_at TIMESTAMPTZ CHECK (
    e2e_finished_at IS NULL OR e2e_started_at IS NULL
    OR e2e_finished_at >= e2e_started_at
  ),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_release_bootstrap_attempt_confirmed
  ON kernel_release_bootstrap_effect_receipts (effect_attempt_id)
  WHERE receipt_status = 'confirmed';

CREATE OR REPLACE FUNCTION kernel_release_e2e_manifest_guard()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM kernel_release_runs release
      JOIN initiative_runs run
        ON run.id = release.run_id
       AND run.id = NEW.run_id
       AND run.contract_id = NEW.contract_id
      JOIN initiative_contracts contract
        ON contract.id = NEW.contract_id
       AND contract.status = 'approved'
       AND contract.version = NEW.contract_version
       AND contract.approved_at = NEW.contract_approved_at
       AND contract.contract_content = NEW.contract_content
       AND contract.e2e_acceptance = NEW.e2e_acceptance
     WHERE release.id = NEW.release_run_id
       AND release.repository = NEW.repository
       AND release.merge_sha = NEW.merge_sha
       AND release.artifact_versions = NEW.artifact_versions
  ) THEN
    RAISE EXCEPTION
      'release E2E manifest requires the exact approved run contract and merge SHA';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_e2e_manifest_guard
  ON kernel_release_e2e_manifests;
CREATE TRIGGER trg_kernel_release_e2e_manifest_guard
  BEFORE INSERT ON kernel_release_e2e_manifests
  FOR EACH ROW EXECUTE FUNCTION kernel_release_e2e_manifest_guard();

CREATE OR REPLACE FUNCTION kernel_release_bootstrap_e2e_manifest_guard()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM kernel_release_bootstrap_runs bootstrap
      JOIN initiative_runs run
        ON run.id = NEW.run_id
       AND run.contract_id = NEW.contract_id
      JOIN initiative_contracts contract
        ON contract.id = NEW.contract_id
       AND contract.status = 'approved'
       AND contract.version = NEW.contract_version
       AND contract.approved_at = NEW.contract_approved_at
       AND contract.contract_content = NEW.contract_content
       AND contract.e2e_acceptance = NEW.e2e_acceptance
      JOIN kernel_merge_authorizations auth
        ON auth.run_id = run.id
       AND auth.repository = bootstrap.repository
       AND auth.pr_number = bootstrap.pr_number
      JOIN kernel_merge_effect_intents intent
        ON intent.authorization_id = auth.id
       AND intent.requested_head_sha = bootstrap.source_head_sha
      JOIN kernel_merge_effect_receipts receipt
        ON receipt.intent_id = intent.id
       AND receipt.receipt_status = 'confirmed'
       AND receipt.merged = TRUE
       AND receipt.observed_head_sha = intent.requested_head_sha
       AND receipt.evidence->>'merge_commit_sha' = bootstrap.merge_sha
     WHERE bootstrap.id = NEW.bootstrap_run_id
       AND bootstrap.repository = NEW.repository
       AND bootstrap.merge_sha = NEW.merge_sha
  ) THEN
    RAISE EXCEPTION
      'bootstrap E2E manifest requires the exact approved merge run contract';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_e2e_manifest_guard
  ON kernel_release_bootstrap_e2e_manifests;
CREATE TRIGGER trg_kernel_release_bootstrap_e2e_manifest_guard
  BEFORE INSERT ON kernel_release_bootstrap_e2e_manifests
  FOR EACH ROW EXECUTE FUNCTION kernel_release_bootstrap_e2e_manifest_guard();

CREATE OR REPLACE FUNCTION kernel_release_contract_immutability_guard()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM kernel_release_e2e_manifests
     WHERE contract_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM kernel_release_bootstrap_e2e_manifests
     WHERE contract_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'referenced approved contract is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_contract_immutability
  ON initiative_contracts;
CREATE TRIGGER trg_kernel_release_contract_immutability
  BEFORE UPDATE OR DELETE ON initiative_contracts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_contract_immutability_guard();

CREATE OR REPLACE FUNCTION kernel_release_effect_receipt_guard()
RETURNS trigger AS $$
DECLARE
  intent kernel_release_effect_intents%ROWTYPE;
  manifest kernel_release_e2e_manifests%ROWTYPE;
  claim kernel_release_effect_dispatch_claims%ROWTYPE;
  outcome kernel_release_effect_dispatch_outcomes%ROWTYPE;
  effective_lease_expires_at TIMESTAMPTZ;
  verification JSONB;
  result JSONB;
  result_index BIGINT;
BEGIN
  IF NEW.receipt_status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO intent
    FROM kernel_release_effect_intents
   WHERE id = NEW.intent_id;

  IF NEW.observed_merge_sha IS DISTINCT FROM intent.expected_merge_sha THEN
    RAISE EXCEPTION 'confirmed release receipt requires exact merge SHA';
  END IF;
  IF NEW.observed_artifact_versions IS DISTINCT FROM intent.expected_artifact_versions THEN
    RAISE EXCEPTION 'confirmed release receipt requires exact artifact versions';
  END IF;

  SELECT * INTO claim
    FROM kernel_release_effect_dispatch_claims
   WHERE id = NEW.dispatch_claim_id
     AND intent_id = intent.id
     AND generation = NEW.dispatch_generation;
  SELECT * INTO outcome
    FROM kernel_release_effect_dispatch_outcomes
   WHERE dispatch_claim_id = claim.id;
  SELECT GREATEST(
           claim.lease_expires_at,
           COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
         )
    INTO effective_lease_expires_at
    FROM kernel_release_effect_dispatch_renewals renewal
   WHERE renewal.dispatch_claim_id = claim.id
     AND renewal.generation = claim.generation;
  IF claim.id IS NULL
     OR claim.generation IS DISTINCT FROM (
       SELECT MAX(latest.generation)
         FROM kernel_release_effect_dispatch_claims latest
        WHERE latest.intent_id = intent.id
     )
     OR claim.claim_mode IS DISTINCT FROM 'verification'
     OR outcome.outcome IS DISTINCT FROM 'observed'
     OR effective_lease_expires_at IS NULL
     OR effective_lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION
      'confirmed release receipt requires latest live observed dispatch generation';
  END IF;

  SELECT *
    INTO manifest
    FROM kernel_release_e2e_manifests
   WHERE id = NEW.e2e_manifest_id
     AND release_run_id = intent.release_run_id;
  IF manifest.id IS NULL
     OR NEW.e2e_manifest_digest IS DISTINCT FROM manifest.manifest_digest
     OR NEW.e2e_scenarios_total IS DISTINCT FROM manifest.scenarios_total
     OR NEW.e2e_scenarios_passed IS DISTINCT FROM manifest.scenarios_total
     OR NEW.e2e_environment IS DISTINCT FROM intent.effect_kind
     OR jsonb_typeof(NEW.e2e_scenario_results) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.e2e_scenario_results)
        IS DISTINCT FROM manifest.scenarios_total
     OR NEW.e2e_started_at IS NULL
     OR NEW.e2e_finished_at IS NULL THEN
    RAISE EXCEPTION 'confirmed release receipt requires exact E2E manifest';
  END IF;
  FOR result, result_index IN
    SELECT value, ordinality
      FROM jsonb_array_elements(NEW.e2e_scenario_results) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(result) IS DISTINCT FROM 'object'
       OR (
         SELECT count(*)
           FROM jsonb_object_keys(
             CASE WHEN jsonb_typeof(result) = 'object'
               THEN result ELSE '{}'::jsonb END
           )
       ) IS DISTINCT FROM 5::bigint
       OR result->>'status' IS DISTINCT FROM 'pass'
       OR result->>'name' IS DISTINCT FROM
          manifest.e2e_acceptance->'scenarios'->(result_index::integer - 1)->>'name'
       OR COALESCE(result->>'started_at', '')
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
       OR COALESCE(result->>'finished_at', '')
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
       OR COALESCE(result->>'log_digest', '')
          !~ '^sha256:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'confirmed release receipt has invalid scenario result';
    END IF;
  END LOOP;

  verification := NEW.evidence->'verification';
  IF intent.effect_kind = 'staging'
     AND (
       verification->>'status' IS DISTINCT FROM 'pass'
       OR verification->>'required_e2e' IS DISTINCT FROM 'pass'
       OR verification->>'e2e_manifest_digest'
          IS DISTINCT FROM manifest.manifest_digest
       OR (verification->>'e2e_scenarios_total')::integer
          IS DISTINCT FROM manifest.scenarios_total
       OR (verification->>'e2e_scenarios_passed')::integer
          IS DISTINCT FROM manifest.scenarios_total
     ) THEN
    RAISE EXCEPTION
      'confirmed staging receipt requires pass verification and exact E2E manifest';
  END IF;
  IF intent.effect_kind = 'production'
     AND (
       verification->>'status' IS DISTINCT FROM 'pass'
       OR verification->>'health' IS DISTINCT FROM 'pass'
       OR verification->>'required_e2e' IS DISTINCT FROM 'pass'
       OR verification->>'e2e_manifest_digest'
          IS DISTINCT FROM manifest.manifest_digest
       OR (verification->>'e2e_scenarios_total')::integer
          IS DISTINCT FROM manifest.scenarios_total
       OR (verification->>'e2e_scenarios_passed')::integer
          IS DISTINCT FROM manifest.scenarios_total
       OR COALESCE(verification#>>'{rollback_metadata,anchor}', '') = ''
       OR COALESCE(verification#>>'{rollback_metadata,previous_version}', '') = ''
     ) THEN
    RAISE EXCEPTION
      'confirmed production receipt requires health and E2E verification';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_effect_receipt_guard
  ON kernel_release_effect_receipts;
CREATE TRIGGER trg_kernel_release_effect_receipt_guard
  BEFORE INSERT ON kernel_release_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_effect_receipt_guard();

CREATE OR REPLACE FUNCTION kernel_release_rollback_intent_guard()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM kernel_release_runs release
     WHERE release.id = NEW.release_run_id
       AND release.merge_sha = NEW.expected_merge_sha
       AND release.artifact_versions = NEW.expected_artifact_versions
  ) THEN
    RAISE EXCEPTION 'rollback intent requires exact ReleaseRun identity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_rollback_intent_guard
  ON kernel_release_rollback_intents;
CREATE TRIGGER trg_kernel_release_rollback_intent_guard
  BEFORE INSERT ON kernel_release_rollback_intents
  FOR EACH ROW EXECUTE FUNCTION kernel_release_rollback_intent_guard();

CREATE OR REPLACE FUNCTION kernel_release_rollback_receipt_guard()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM kernel_release_rollback_intents rollback_intent
      JOIN kernel_release_effect_intents effect_intent
        ON effect_intent.release_run_id = rollback_intent.release_run_id
       AND effect_intent.effect_kind = 'production'
      JOIN kernel_release_effect_receipts effect_receipt
        ON effect_receipt.intent_id = effect_intent.id
       AND effect_receipt.id = NEW.effect_receipt_id
       AND effect_receipt.receipt_status = 'confirmed'
     WHERE rollback_intent.id = NEW.rollback_intent_id
       AND effect_receipt.observed_merge_sha =
           rollback_intent.expected_merge_sha
       AND effect_receipt.observed_artifact_versions =
           rollback_intent.expected_artifact_versions
       AND effect_receipt.evidence#>'{verification,rollback_metadata}' =
           NEW.rollback_metadata
       AND NEW.anchor =
           effect_receipt.evidence#>>'{verification,rollback_metadata,anchor}'
       AND NEW.previous_version =
           effect_receipt.evidence#>>'{verification,rollback_metadata,previous_version}'
  ) THEN
    RAISE EXCEPTION
      'rollback receipt requires exact confirmed production readback';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_rollback_receipt_guard
  ON kernel_release_rollback_receipts;
CREATE TRIGGER trg_kernel_release_rollback_receipt_guard
  BEFORE INSERT ON kernel_release_rollback_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_rollback_receipt_guard();

CREATE OR REPLACE FUNCTION kernel_release_bootstrap_effect_receipt_guard()
RETURNS trigger AS $$
DECLARE
  attempt kernel_release_bootstrap_effect_attempts%ROWTYPE;
  manifest kernel_release_bootstrap_e2e_manifests%ROWTYPE;
  effective_lease_expires_at TIMESTAMPTZ;
  result JSONB;
  result_index BIGINT;
BEGIN
  IF NEW.receipt_status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO attempt
    FROM kernel_release_bootstrap_effect_attempts
   WHERE id = NEW.effect_attempt_id;
  SELECT GREATEST(
           attempt.lease_expires_at,
           COALESCE(MAX(renewal.lease_expires_at), attempt.lease_expires_at)
         )
    INTO effective_lease_expires_at
    FROM kernel_release_bootstrap_effect_attempt_renewals renewal
   WHERE renewal.effect_attempt_id = attempt.id
     AND renewal.generation = attempt.generation;
  IF attempt.id IS NULL
     OR attempt.generation IS DISTINCT FROM (
       SELECT MAX(latest.generation)
         FROM kernel_release_bootstrap_effect_attempts latest
        WHERE latest.bootstrap_run_id = attempt.bootstrap_run_id
          AND latest.effect_kind = attempt.effect_kind
     )
     OR effective_lease_expires_at IS NULL
     OR effective_lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION
      'confirmed bootstrap receipt requires latest live attempt generation';
  END IF;
  SELECT * INTO manifest
    FROM kernel_release_bootstrap_e2e_manifests
   WHERE id = NEW.e2e_manifest_id
     AND bootstrap_run_id = attempt.bootstrap_run_id;
  IF manifest.id IS NULL
     OR NEW.observed_merge_sha IS DISTINCT FROM manifest.merge_sha
     OR NEW.observed_artifact_versions IS DISTINCT FROM manifest.artifact_versions
     OR NEW.e2e_manifest_digest IS DISTINCT FROM manifest.manifest_digest
     OR NEW.e2e_scenarios_total IS DISTINCT FROM manifest.scenarios_total
     OR NEW.e2e_scenarios_passed IS DISTINCT FROM manifest.scenarios_total
     OR NEW.e2e_environment IS DISTINCT FROM attempt.effect_kind
     OR jsonb_typeof(NEW.e2e_scenario_results) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.e2e_scenario_results)
        IS DISTINCT FROM manifest.scenarios_total
     OR NEW.e2e_started_at IS NULL
     OR NEW.e2e_finished_at IS NULL
     OR NEW.evidence->>'required_e2e' IS DISTINCT FROM 'pass'
     OR NEW.evidence->>'merge_sha' IS DISTINCT FROM manifest.merge_sha THEN
    RAISE EXCEPTION
      'confirmed bootstrap receipt requires exact E2E manifest';
  END IF;
  FOR result, result_index IN
    SELECT value, ordinality
      FROM jsonb_array_elements(NEW.e2e_scenario_results) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(result) IS DISTINCT FROM 'object'
       OR (
         SELECT count(*)
           FROM jsonb_object_keys(
             CASE WHEN jsonb_typeof(result) = 'object'
               THEN result ELSE '{}'::jsonb END
           )
       ) IS DISTINCT FROM 5::bigint
       OR result->>'status' IS DISTINCT FROM 'pass'
       OR result->>'name' IS DISTINCT FROM
          manifest.e2e_acceptance->'scenarios'->(result_index::integer - 1)->>'name'
       OR COALESCE(result->>'started_at', '')
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
       OR COALESCE(result->>'finished_at', '')
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
       OR COALESCE(result->>'log_digest', '')
          !~ '^sha256:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'confirmed bootstrap receipt has invalid scenario result';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_effect_receipt_guard
  ON kernel_release_bootstrap_effect_receipts;
CREATE TRIGGER trg_kernel_release_bootstrap_effect_receipt_guard
  BEFORE INSERT ON kernel_release_bootstrap_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_bootstrap_effect_receipt_guard();

CREATE OR REPLACE FUNCTION kernel_release_transition_guard()
RETURNS trigger AS $$
DECLARE
  previous_state TEXT;
  expected_state TEXT;
  exact_merge_sha TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.release_run_id::text, 0));

  SELECT merge_sha INTO exact_merge_sha
    FROM kernel_release_runs
   WHERE id = NEW.release_run_id;
  IF exact_merge_sha IS NULL
     OR NEW.evidence->>'merge_sha' IS DISTINCT FROM exact_merge_sha THEN
    RAISE EXCEPTION 'release transition requires exact merge SHA evidence';
  END IF;

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

  IF NEW.state = 'staging_passed' AND NOT EXISTS (
    SELECT 1
      FROM kernel_release_effect_intents intent
      JOIN kernel_release_effect_receipts receipt
        ON receipt.intent_id = intent.id
     WHERE intent.release_run_id = NEW.release_run_id
       AND intent.effect_kind = 'staging'
       AND receipt.receipt_status = 'confirmed'
       AND receipt.observed_merge_sha = intent.expected_merge_sha
       AND receipt.observed_artifact_versions = intent.expected_artifact_versions
       AND NEW.evidence->>'effect_receipt_id' = receipt.id::text
       AND NEW.evidence->>'e2e_manifest_digest' = receipt.e2e_manifest_digest
  ) THEN
    RAISE EXCEPTION 'staging_passed requires confirmed staging effect receipt';
  END IF;

  IF NEW.state = 'production_verified' AND NOT EXISTS (
    SELECT 1
      FROM kernel_release_effect_intents intent
      JOIN kernel_release_effect_receipts receipt
        ON receipt.intent_id = intent.id
     WHERE intent.release_run_id = NEW.release_run_id
       AND intent.effect_kind = 'production'
       AND receipt.receipt_status = 'confirmed'
       AND receipt.observed_merge_sha = intent.expected_merge_sha
       AND receipt.observed_artifact_versions = intent.expected_artifact_versions
       AND NEW.evidence->>'effect_receipt_id' = receipt.id::text
       AND NEW.evidence->>'e2e_manifest_digest' = receipt.e2e_manifest_digest
  ) THEN
    RAISE EXCEPTION 'production_verified requires confirmed production effect receipt';
  END IF;
  IF NEW.state = 'production_verified' AND NOT EXISTS (
    SELECT 1
      FROM kernel_release_rollback_intents rollback_intent
      JOIN kernel_release_rollback_receipts rollback_receipt
        ON rollback_receipt.rollback_intent_id = rollback_intent.id
     WHERE rollback_intent.release_run_id = NEW.release_run_id
       AND NEW.evidence->>'rollback_receipt_id' = rollback_receipt.id::text
       AND NEW.evidence->>'effect_receipt_id' =
           rollback_receipt.effect_receipt_id::text
  ) THEN
    RAISE EXCEPTION
      'production_verified requires exact durable rollback receipt';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kernel_release_bootstrap_transition_guard()
RETURNS trigger AS $$
DECLARE
  previous_state TEXT;
  expected_state TEXT;
  exact_merge_sha TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.bootstrap_run_id::text, 0));

  SELECT merge_sha INTO exact_merge_sha
    FROM kernel_release_bootstrap_runs
   WHERE id = NEW.bootstrap_run_id;
  IF exact_merge_sha IS NULL
     OR NEW.evidence->>'merge_sha' IS DISTINCT FROM exact_merge_sha THEN
    RAISE EXCEPTION 'bootstrap transition requires exact merge SHA evidence';
  END IF;

  SELECT state
    INTO previous_state
    FROM kernel_release_bootstrap_transitions
   WHERE bootstrap_run_id = NEW.bootstrap_run_id
   ORDER BY append_seq DESC
   LIMIT 1;

  expected_state := CASE
    WHEN previous_state IS NULL THEN 'approved'
    WHEN previous_state = 'approved' THEN 'staging_intent'
    WHEN previous_state = 'staging_intent' THEN 'staging_passed'
    WHEN previous_state = 'staging_passed' THEN 'production_intent'
    WHEN previous_state = 'production_intent' THEN 'production_verified'
    ELSE NULL
  END;

  IF NEW.state IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION
      'invalid kernel bootstrap transition: % -> % (expected %)',
      COALESCE(previous_state, '<none>'), NEW.state, COALESCE(expected_state, '<terminal>');
  END IF;

  IF NEW.state = 'staging_passed' AND NOT EXISTS (
    SELECT 1
      FROM kernel_release_bootstrap_effect_attempts a
      JOIN kernel_release_bootstrap_effect_receipts r
        ON r.effect_attempt_id = a.id
     WHERE a.bootstrap_run_id = NEW.bootstrap_run_id
       AND a.effect_kind = 'staging'
       AND r.receipt_status = 'confirmed'
       AND NEW.evidence->>'effect_receipt_id' = r.id::text
       AND NEW.evidence->>'e2e_manifest_digest' = r.e2e_manifest_digest
  ) THEN
    RAISE EXCEPTION 'staging_passed requires confirmed staging effect receipt';
  END IF;

  IF NEW.state = 'production_verified' AND NOT EXISTS (
    SELECT 1
      FROM kernel_release_bootstrap_effect_attempts a
      JOIN kernel_release_bootstrap_effect_receipts r
        ON r.effect_attempt_id = a.id
     WHERE a.bootstrap_run_id = NEW.bootstrap_run_id
       AND a.effect_kind = 'production'
       AND r.receipt_status = 'confirmed'
       AND NEW.evidence->>'effect_receipt_id' = r.id::text
       AND NEW.evidence->>'e2e_manifest_digest' = r.e2e_manifest_digest
  ) THEN
    RAISE EXCEPTION 'production_verified requires confirmed production effect receipt';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_transition_guard
  ON kernel_release_bootstrap_transitions;
CREATE TRIGGER trg_kernel_release_bootstrap_transition_guard
  BEFORE INSERT ON kernel_release_bootstrap_transitions
  FOR EACH ROW EXECUTE FUNCTION kernel_release_bootstrap_transition_guard();

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

DROP TRIGGER IF EXISTS trg_kernel_release_e2e_manifests_append_only
  ON kernel_release_e2e_manifests;
CREATE TRIGGER trg_kernel_release_e2e_manifests_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_e2e_manifests
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_effect_intents_append_only ON kernel_release_effect_intents;
CREATE TRIGGER trg_kernel_release_effect_intents_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_effect_intents
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_effect_receipts_append_only ON kernel_release_effect_receipts;
CREATE TRIGGER trg_kernel_release_effect_receipts_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_rollback_intents_append_only
  ON kernel_release_rollback_intents;
CREATE TRIGGER trg_kernel_release_rollback_intents_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_rollback_intents
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_rollback_receipts_append_only
  ON kernel_release_rollback_receipts;
CREATE TRIGGER trg_kernel_release_rollback_receipts_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_rollback_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_blocked_escalations_append_only
  ON kernel_release_blocked_escalations;
CREATE TRIGGER trg_kernel_release_blocked_escalations_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_blocked_escalations
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

DROP TRIGGER IF EXISTS trg_kernel_release_effect_dispatch_renewals_append_only
  ON kernel_release_effect_dispatch_renewals;
CREATE TRIGGER trg_kernel_release_effect_dispatch_renewals_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_effect_dispatch_renewals
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_runs_append_only
  ON kernel_release_bootstrap_runs;
CREATE TRIGGER trg_kernel_release_bootstrap_runs_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_bootstrap_runs
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_transitions_append_only
  ON kernel_release_bootstrap_transitions;
CREATE TRIGGER trg_kernel_release_bootstrap_transitions_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_bootstrap_transitions
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_e2e_manifests_append_only
  ON kernel_release_bootstrap_e2e_manifests;
CREATE TRIGGER trg_kernel_release_bootstrap_e2e_manifests_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_bootstrap_e2e_manifests
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_effect_attempts_append_only
  ON kernel_release_bootstrap_effect_attempts;
CREATE TRIGGER trg_kernel_release_bootstrap_effect_attempts_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_bootstrap_effect_attempts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_attempt_renewals_append_only
  ON kernel_release_bootstrap_effect_attempt_renewals;
CREATE TRIGGER trg_kernel_release_bootstrap_attempt_renewals_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_bootstrap_effect_attempt_renewals
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_effect_receipts_append_only
  ON kernel_release_bootstrap_effect_receipts;
CREATE TRIGGER trg_kernel_release_bootstrap_effect_receipts_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_bootstrap_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_ledger_append_only();

DO $$
DECLARE
  ledger_table TEXT;
BEGIN
  FOREACH ledger_table IN ARRAY ARRAY[
    'kernel_release_runs',
    'kernel_release_e2e_manifests',
    'kernel_release_transitions',
    'kernel_release_effect_intents',
    'kernel_release_effect_receipts',
    'kernel_release_effect_dispatch_claims',
    'kernel_release_effect_dispatch_renewals',
    'kernel_release_effect_dispatch_outcomes',
    'kernel_release_rollback_intents',
    'kernel_release_rollback_receipts',
    'kernel_release_blocked_escalations',
    'kernel_release_bootstrap_runs',
    'kernel_release_bootstrap_e2e_manifests',
    'kernel_release_bootstrap_transitions',
    'kernel_release_bootstrap_effect_attempts',
    'kernel_release_bootstrap_effect_attempt_renewals',
    'kernel_release_bootstrap_effect_receipts'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I',
      'trg_' || ledger_table || '_truncate',
      ledger_table
    );
  END LOOP;
END;
$$;

CREATE TRIGGER trg_kernel_release_runs_truncate
  BEFORE TRUNCATE ON kernel_release_runs
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_e2e_manifests_truncate
  BEFORE TRUNCATE ON kernel_release_e2e_manifests
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_transitions_truncate
  BEFORE TRUNCATE ON kernel_release_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_effect_intents_truncate
  BEFORE TRUNCATE ON kernel_release_effect_intents
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_effect_receipts_truncate
  BEFORE TRUNCATE ON kernel_release_effect_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_effect_dispatch_claims_truncate
  BEFORE TRUNCATE ON kernel_release_effect_dispatch_claims
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_effect_dispatch_renewals_truncate
  BEFORE TRUNCATE ON kernel_release_effect_dispatch_renewals
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_effect_dispatch_outcomes_truncate
  BEFORE TRUNCATE ON kernel_release_effect_dispatch_outcomes
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_rollback_intents_truncate
  BEFORE TRUNCATE ON kernel_release_rollback_intents
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_rollback_receipts_truncate
  BEFORE TRUNCATE ON kernel_release_rollback_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_blocked_escalations_truncate
  BEFORE TRUNCATE ON kernel_release_blocked_escalations
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_bootstrap_runs_truncate
  BEFORE TRUNCATE ON kernel_release_bootstrap_runs
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_bootstrap_e2e_manifests_truncate
  BEFORE TRUNCATE ON kernel_release_bootstrap_e2e_manifests
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_bootstrap_transitions_truncate
  BEFORE TRUNCATE ON kernel_release_bootstrap_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_bootstrap_effect_attempts_truncate
  BEFORE TRUNCATE ON kernel_release_bootstrap_effect_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_bootstrap_effect_attempt_renewals_truncate
  BEFORE TRUNCATE ON kernel_release_bootstrap_effect_attempt_renewals
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();
CREATE TRIGGER trg_kernel_release_bootstrap_effect_receipts_truncate
  BEFORE TRUNCATE ON kernel_release_bootstrap_effect_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_release_ledger_append_only();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('375', 'Fence and close Kernel ReleaseRun authority and receipts', NOW())
ON CONFLICT (version) DO NOTHING;
