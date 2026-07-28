-- Migration 377: isolated production cases for Kernel equivalence drills.
--
-- Integration ordering: ReleaseRun owns migrations 374 and 375; trusted runtime owns migration 376.
-- This migration follows all three and does not overwrite their schemas or evidence.

CREATE TABLE IF NOT EXISTS kernel_equivalence_production_cases (
  case_id UUID PRIMARY KEY,
  cell_id TEXT NOT NULL CHECK (
    cell_id ~ '^KERNEL-P[01]-[0-9A-Z-]+::(claude|codex|grok)::(normal|violation|recovery)$'
  ),
  behavior_id TEXT NOT NULL CHECK (
    behavior_id ~ '^KERNEL-P[01]-[0-9A-Z-]+$'
  ),
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'grok')),
  scenario TEXT NOT NULL CHECK (
    scenario IN ('normal', 'violation', 'recovery')
  ),
  seam_id TEXT NOT NULL CHECK (seam_id IN (
    'kernel.workspace.protected_ref_guard',
    'kernel.credential.attempt_lease',
    'kernel.github.mutation_broker',
    'kernel.merge.effect_executor',
    'kernel.evaluation.independent_judge',
    'kernel.merge.human_review_authority',
    'kernel.release.staging_promotion',
    'kernel.liveness.orphan_recovery',
    'kernel.quality.devgate',
    'kernel.controller.attempt_ownership',
    'kernel.closure.report_learning'
  )),
  adapter_id TEXT NOT NULL CHECK (
    adapter_id ~ '^kernel[.]drill[.][a-z0-9_]+[.]v1$'
  ),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  attempt_id UUID NOT NULL REFERENCES harness_attempts(id),
  artifact_sha TEXT NOT NULL CHECK (artifact_sha ~ '^[0-9a-f]{40}$'),
  brain_version TEXT NOT NULL CHECK (
    brain_version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'
  ),
  engine_version TEXT NOT NULL CHECK (
    engine_version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'
  ),
  resource_type TEXT NOT NULL CHECK (resource_type IN (
    'ephemeral_branch',
    'ephemeral_credential_lease',
    'ephemeral_database_record',
    'ephemeral_run',
    'ephemeral_staging',
    'ephemeral_workspace'
  )),
  resource_prefix TEXT NOT NULL CHECK (
    length(resource_prefix) BETWEEN 1 AND 512
    AND resource_prefix !~ E'[\\000\\r\\n]'
    AND resource_prefix !~* '(^|[/_.:-])(main|master|production|prod|release)($|[/_.:-])'
  ),
  resource_id TEXT NOT NULL CHECK (
    length(resource_id) BETWEEN 1 AND 512
    AND resource_id !~ E'[\\000\\r\\n]'
  ),
  resource_ref TEXT NOT NULL CHECK (
    length(resource_ref) BETWEEN 1 AND 2048
    AND resource_ref !~ E'[\\000\\r\\n]'
    AND resource_ref LIKE resource_prefix || '%'
    AND resource_ref <> resource_prefix
    AND resource_ref !~* '(^|[/_.:-])(main|master|production|prod|release)($|[/_.:-])'
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_kernel_equivalence_production_case_execution
    UNIQUE (cell_id, run_id, attempt_id, resource_id),
  CONSTRAINT uq_kernel_equivalence_production_case_resource_ref
    UNIQUE (resource_ref),
  CHECK (cell_id = behavior_id || '::' || provider || '::' || scenario),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_production_case_expiry
  ON kernel_equivalence_production_cases (expires_at, case_id);

CREATE TABLE IF NOT EXISTS kernel_equivalence_production_case_leases (
  case_id UUID PRIMARY KEY
    REFERENCES kernel_equivalence_production_cases(case_id),
  owner_id TEXT NOT NULL CHECK (
    length(owner_id) BETWEEN 1 AND 256
    AND owner_id !~ E'[\\000\\r\\n]'
  ),
  generation BIGINT NOT NULL DEFAULT 1 CHECK (generation >= 1),
  state TEXT NOT NULL CHECK (state IN (
    'prepared',
    'cancelling',
    'cleanup_unconfirmed',
    'cleaned'
  )),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_case_lease_expiry
  ON kernel_equivalence_production_case_leases
    (state, lease_expires_at, case_id);

CREATE TABLE IF NOT EXISTS kernel_equivalence_production_case_events (
  event_id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES kernel_equivalence_production_cases(case_id),
  generation BIGINT NOT NULL CHECK (generation >= 1),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'prepared',
    'cancel_requested',
    'cancel_confirmed',
    'cleanup_confirmed',
    'cleanup_unconfirmed',
    'inspection'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'confirmed',
    'denied',
    'unconfirmed'
  )),
  evidence_ref TEXT NOT NULL CHECK (
    length(evidence_ref) BETWEEN 1 AND 2048
    AND evidence_ref !~ E'[\\000\\r\\n]'
  ),
  before_hash TEXT CHECK (
    before_hash IS NULL OR before_hash ~ '^[0-9a-f]{64}$'
  ),
  after_hash TEXT CHECK (
    after_hash IS NULL OR after_hash ~ '^[0-9a-f]{64}$'
  ),
  late_effect_risk BOOLEAN NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_kernel_equivalence_production_case_event
    UNIQUE (case_id, generation, event_type)
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_case_events_case
  ON kernel_equivalence_production_case_events
    (case_id, generation, occurred_at);

CREATE OR REPLACE FUNCTION kernel_equivalence_production_case_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'kernel equivalence production case ledger is append-only (% blocked)',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kernel_equivalence_production_case_run_guard()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM harness_attempts
     WHERE id = NEW.attempt_id
       AND run_id = NEW.run_id
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence production case attempt/run ownership mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kernel_equivalence_case_lease_advance_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.case_id <> OLD.case_id
     OR NEW.owner_id <> OLD.owner_id
     OR NEW.generation <> OLD.generation + 1
     OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION
      'kernel equivalence production case lease advance is invalid';
  END IF;

  IF NEW.state NOT IN ('cleanup_unconfirmed', 'cleaned')
     AND NEW.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION
      'kernel equivalence production case lease is expired';
  END IF;

  IF NOT (
    (OLD.state = 'prepared'
      AND NEW.state IN ('cancelling', 'cleanup_unconfirmed', 'cleaned'))
    OR (OLD.state = 'cancelling'
      AND NEW.state IN ('cleanup_unconfirmed', 'cleaned'))
    OR (OLD.state = 'cleanup_unconfirmed'
      AND NEW.state IN ('cancelling', 'cleaned'))
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence production case lease transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_production_case_run_guard
  ON kernel_equivalence_production_cases;
CREATE TRIGGER trg_kernel_equivalence_production_case_run_guard
  BEFORE INSERT ON kernel_equivalence_production_cases
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_production_case_run_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_production_cases_append_only
  ON kernel_equivalence_production_cases;
CREATE TRIGGER trg_kernel_equivalence_production_cases_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_production_cases
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_production_case_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_production_cases_no_truncate
  ON kernel_equivalence_production_cases;
CREATE TRIGGER trg_kernel_equivalence_production_cases_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_production_cases
  FOR EACH STATEMENT
  EXECUTE FUNCTION kernel_equivalence_production_case_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_production_events_append_only
  ON kernel_equivalence_production_case_events;
CREATE TRIGGER trg_kernel_equivalence_production_events_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_production_case_events
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_production_case_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_production_events_no_truncate
  ON kernel_equivalence_production_case_events;
CREATE TRIGGER trg_kernel_equivalence_production_events_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_production_case_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION kernel_equivalence_production_case_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_lease_advance_guard
  ON kernel_equivalence_production_case_leases;
CREATE TRIGGER trg_kernel_equivalence_case_lease_advance_guard
  BEFORE UPDATE ON kernel_equivalence_production_case_leases
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_case_lease_advance_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_leases_no_delete
  ON kernel_equivalence_production_case_leases;
CREATE TRIGGER trg_kernel_equivalence_case_leases_no_delete
  BEFORE DELETE ON kernel_equivalence_production_case_leases
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_production_case_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_leases_no_truncate
  ON kernel_equivalence_production_case_leases;
CREATE TRIGGER trg_kernel_equivalence_case_leases_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_production_case_leases
  FOR EACH STATEMENT
  EXECUTE FUNCTION kernel_equivalence_production_case_append_only();

INSERT INTO schema_version (version, description)
VALUES ('377', 'kernel_equivalence_production_cases')
ON CONFLICT (version) DO NOTHING;
