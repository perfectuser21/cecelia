-- PROVISIONAL Migration 375: trusted Kernel equivalence execution runtime.
--
-- Integration ordering: this line depends on migration 374 (ReleaseRun) landing
-- first. Integration may renumber this migration if the risk/ReleaseRun join
-- claims 375. No table below references ReleaseRun, which keeps renumbering
-- mechanical and preserves isolated review/testing from the 372 base.

CREATE TABLE IF NOT EXISTS kernel_equivalence_execution_nonces (
  grant_id UUID PRIMARY KEY,
  nonce UUID NOT NULL UNIQUE,
  cell_id TEXT NOT NULL CHECK (
    cell_id ~ '^KERNEL-P[01]-[0-9A-Z-]+::(claude|codex|grok)::(normal|violation|recovery)$'
  ),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  attempt_id UUID NOT NULL REFERENCES harness_attempts(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > consumed_at)
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_nonces_attempt
  ON kernel_equivalence_execution_nonces (run_id, attempt_id, consumed_at);

CREATE TABLE IF NOT EXISTS kernel_equivalence_denial_audits (
  audit_id UUID PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status = 'blocked'),
  code TEXT NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,127}$'),
  stage TEXT NOT NULL CHECK (stage ~ '^[a-z][a-z0-9_]{0,127}$'),
  cell_id TEXT,
  behavior_id TEXT,
  provider TEXT CHECK (provider IS NULL OR provider IN ('claude', 'codex', 'grok')),
  scenario TEXT CHECK (
    scenario IS NULL OR scenario IN ('normal', 'violation', 'recovery')
  ),
  run_id UUID,
  attempt_id UUID,
  late_effect_risk BOOLEAN NOT NULL,
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'kernel-equivalence-denial-audit/v1'
  ),
  persisted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_audits_attempt
  ON kernel_equivalence_denial_audits (run_id, attempt_id, occurred_at);

CREATE TABLE IF NOT EXISTS kernel_equivalence_bundle_chain_heads (
  chain_id TEXT PRIMARY KEY CHECK (chain_id = 'kernel-equivalence-v1'),
  genesis_hash TEXT CHECK (
    genesis_hash IS NULL OR genesis_hash ~ '^[0-9a-f]{64}$'
  ),
  head_hash TEXT CHECK (
    head_hash IS NULL OR head_hash ~ '^[0-9a-f]{64}$'
  ),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (genesis_hash IS NULL AND head_hash IS NULL AND revision = 0)
    OR (genesis_hash IS NOT NULL AND head_hash IS NOT NULL AND revision > 0)
  )
);

INSERT INTO kernel_equivalence_bundle_chain_heads
  (chain_id, genesis_hash, head_hash, revision)
VALUES ('kernel-equivalence-v1', NULL, NULL, 0)
ON CONFLICT (chain_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS kernel_equivalence_receipt_bundles (
  chain_id TEXT NOT NULL REFERENCES kernel_equivalence_bundle_chain_heads(chain_id),
  bundle_hash TEXT PRIMARY KEY CHECK (bundle_hash ~ '^[0-9a-f]{64}$'),
  previous_bundle_hash TEXT REFERENCES kernel_equivalence_receipt_bundles(bundle_hash),
  bundle_id TEXT NOT NULL UNIQUE CHECK (
    bundle_id ~ '^bundle:[0-9a-f]{64}$'
  ),
  cell_id TEXT NOT NULL,
  behavior_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'grok')),
  scenario TEXT NOT NULL CHECK (scenario IN ('normal', 'violation', 'recovery')),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  attempt_id UUID NOT NULL REFERENCES harness_attempts(id),
  artifact_sha TEXT NOT NULL CHECK (artifact_sha ~ '^[0-9a-f]{40}$'),
  resource_id TEXT NOT NULL,
  resource_ref TEXT NOT NULL,
  seam_id TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  grant_id UUID NOT NULL,
  bundle JSONB NOT NULL CHECK (jsonb_typeof(bundle) = 'object'),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_kernel_equivalence_bundle_execution
    UNIQUE (chain_id, cell_id, run_id, attempt_id, resource_id),
  CHECK (bundle->>'bundle_id' = bundle_id),
  CHECK (bundle->>'cell_id' = cell_id),
  CHECK (bundle->>'behavior_id' = behavior_id),
  CHECK (bundle->>'provider' = provider),
  CHECK (bundle->>'scenario' = scenario),
  CHECK (bundle->>'run_id' = run_id::text),
  CHECK (bundle->>'attempt_id' = attempt_id::text),
  CHECK (bundle->>'artifact_sha' = artifact_sha),
  CHECK (bundle->>'resource_id' = resource_id),
  CHECK (bundle->>'resource_ref' = resource_ref),
  CHECK (bundle->>'seam_id' = seam_id),
  CHECK (bundle->>'adapter_id' = adapter_id),
  CHECK (bundle->>'grant_id' = grant_id::text),
  CHECK (
    (previous_bundle_hash IS NULL AND bundle->>'previous_bundle_hash' IS NULL)
    OR bundle->>'previous_bundle_hash' = previous_bundle_hash
  )
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_predecessor
  ON kernel_equivalence_receipt_bundles (
    cell_id, run_id, attempt_id, artifact_sha,
    resource_id, seam_id, adapter_id, committed_at DESC
  )
  WHERE scenario = 'violation';

CREATE OR REPLACE FUNCTION kernel_equivalence_runtime_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'kernel equivalence runtime ledger is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kernel_equivalence_attempt_run_guard()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM harness_attempts
     WHERE id = NEW.attempt_id
       AND run_id = NEW.run_id
  ) THEN
    RAISE EXCEPTION 'kernel equivalence attempt/run ownership mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_nonce_attempt_run_guard
  ON kernel_equivalence_execution_nonces;
CREATE TRIGGER trg_kernel_equivalence_nonce_attempt_run_guard
  BEFORE INSERT ON kernel_equivalence_execution_nonces
  FOR EACH ROW EXECUTE FUNCTION kernel_equivalence_attempt_run_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_bundle_attempt_run_guard
  ON kernel_equivalence_receipt_bundles;
CREATE TRIGGER trg_kernel_equivalence_bundle_attempt_run_guard
  BEFORE INSERT ON kernel_equivalence_receipt_bundles
  FOR EACH ROW EXECUTE FUNCTION kernel_equivalence_attempt_run_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_nonces_append_only
  ON kernel_equivalence_execution_nonces;
CREATE TRIGGER trg_kernel_equivalence_nonces_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_execution_nonces
  FOR EACH ROW EXECUTE FUNCTION kernel_equivalence_runtime_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_nonces_no_truncate
  ON kernel_equivalence_execution_nonces;
CREATE TRIGGER trg_kernel_equivalence_nonces_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_execution_nonces
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_equivalence_runtime_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_audits_append_only
  ON kernel_equivalence_denial_audits;
CREATE TRIGGER trg_kernel_equivalence_audits_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_denial_audits
  FOR EACH ROW EXECUTE FUNCTION kernel_equivalence_runtime_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_audits_no_truncate
  ON kernel_equivalence_denial_audits;
CREATE TRIGGER trg_kernel_equivalence_audits_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_denial_audits
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_equivalence_runtime_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_bundles_append_only
  ON kernel_equivalence_receipt_bundles;
CREATE TRIGGER trg_kernel_equivalence_bundles_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_receipt_bundles
  FOR EACH ROW EXECUTE FUNCTION kernel_equivalence_runtime_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_bundles_no_truncate
  ON kernel_equivalence_receipt_bundles;
CREATE TRIGGER trg_kernel_equivalence_bundles_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_receipt_bundles
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_equivalence_runtime_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_heads_no_delete
  ON kernel_equivalence_bundle_chain_heads;
CREATE TRIGGER trg_kernel_equivalence_heads_no_delete
  BEFORE DELETE OR TRUNCATE ON kernel_equivalence_bundle_chain_heads
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_equivalence_runtime_append_only();

INSERT INTO schema_version (version, description)
VALUES ('375', 'kernel_equivalence_runtime_provisional')
ON CONFLICT (version) DO NOTHING;
