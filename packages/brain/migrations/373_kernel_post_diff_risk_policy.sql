-- Migration 373: server-authoritative post-diff risk and production behavior proof.

CREATE TABLE IF NOT EXISTS kernel_behavior_production_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (receipt_status = 'confirmed'),
  repository TEXT NOT NULL CHECK (
    repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  ),
  behavior_version TEXT,
  behavior_fingerprint TEXT NOT NULL CHECK (
    behavior_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  capability_fingerprint TEXT NOT NULL CHECK (
    capability_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  path_surface_digest TEXT NOT NULL CHECK (
    path_surface_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  contract_version INTEGER NOT NULL CHECK (contract_version > 0),
  contract_digest TEXT NOT NULL CHECK (
    contract_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  path_class TEXT NOT NULL CHECK (
    path_class IN (
      'application', 'docs', 'test', 'migration', 'ci_workflow',
      'security_credential', 'deploy_release', 'core_orchestration',
      'mixed', 'unknown'
    )
  ),
  production_head_sha TEXT NOT NULL CHECK (
    production_head_sha ~ '^[0-9a-f]{40}$'
  ),
  artifact_digest TEXT NOT NULL CHECK (
    artifact_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  release_run_id UUID NOT NULL,
  release_effect_receipt_id UUID NOT NULL,
  issuer TEXT NOT NULL CHECK (
    issuer = 'kernel-release-controller/v1'
  ),
  receipt_digest TEXT NOT NULL CHECK (
    receipt_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  deployed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > deployed_at),
  CHECK (deployed_at <= created_at + INTERVAL '5 minutes'),
  CHECK (expires_at <= deployed_at + INTERVAL '30 days'),
  CONSTRAINT uq_kernel_behavior_production_receipt
    UNIQUE (receipt_digest)
);

CREATE INDEX IF NOT EXISTS idx_kernel_behavior_production_receipts_lookup
  ON kernel_behavior_production_receipts
    (repository, behavior_fingerprint, deployed_at DESC)
  WHERE receipt_status = 'confirmed';

CREATE TABLE IF NOT EXISTS kernel_post_diff_risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  assessment_hop INTEGER NOT NULL CHECK (assessment_hop > 0),
  repository TEXT NOT NULL,
  head_sha TEXT NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  base_repository TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  base_sha TEXT NOT NULL CHECK (base_sha ~ '^[0-9a-f]{40}$'),
  diff_hash TEXT NOT NULL CHECK (diff_hash ~ '^sha256:[0-9a-f]{64}$'),
  contract_version INTEGER NOT NULL CHECK (contract_version > 0),
  contract_digest TEXT NOT NULL CHECK (
    contract_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  behavior_fingerprint TEXT NOT NULL CHECK (
    behavior_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  capability_fingerprint TEXT NOT NULL CHECK (
    capability_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  path_surface_digest TEXT NOT NULL CHECK (
    path_surface_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  path_class TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  human_review_required BOOLEAN NOT NULL,
  auto_eligible BOOLEAN NOT NULL,
  policy_version TEXT NOT NULL,
  proof_expires_at TIMESTAMPTZ NOT NULL,
  proof_digest TEXT NOT NULL CHECK (
    proof_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  evidence JSONB NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    NOT auto_eligible
    OR (risk_level = 'low' AND NOT human_review_required)
  ),
  CONSTRAINT uq_kernel_post_diff_risk_assessment
    UNIQUE (proof_digest)
);

CREATE INDEX IF NOT EXISTS idx_kernel_post_diff_risk_assessments_run
  ON kernel_post_diff_risk_assessments (run_id, assessed_at DESC);

ALTER TABLE kernel_merge_authorizations
  ADD COLUMN IF NOT EXISTS risk_assessment_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'kernel_merge_authorizations_risk_assessment_fk'
  ) THEN
    ALTER TABLE kernel_merge_authorizations
      ADD CONSTRAINT kernel_merge_authorizations_risk_assessment_fk
      FOREIGN KEY (risk_assessment_id)
      REFERENCES kernel_post_diff_risk_assessments(id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION kernel_post_diff_risk_ledger_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Kernel post-diff risk ledger is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_behavior_production_receipts_append_only
  ON kernel_behavior_production_receipts;
CREATE TRIGGER trg_kernel_behavior_production_receipts_append_only
  BEFORE UPDATE OR DELETE ON kernel_behavior_production_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_post_diff_risk_ledger_append_only();
DROP TRIGGER IF EXISTS trg_kernel_behavior_production_receipts_no_truncate
  ON kernel_behavior_production_receipts;
CREATE TRIGGER trg_kernel_behavior_production_receipts_no_truncate
  BEFORE TRUNCATE ON kernel_behavior_production_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_post_diff_risk_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_post_diff_risk_assessments_append_only
  ON kernel_post_diff_risk_assessments;
CREATE TRIGGER trg_kernel_post_diff_risk_assessments_append_only
  BEFORE UPDATE OR DELETE ON kernel_post_diff_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION kernel_post_diff_risk_ledger_append_only();
DROP TRIGGER IF EXISTS trg_kernel_post_diff_risk_assessments_no_truncate
  ON kernel_post_diff_risk_assessments;
CREATE TRIGGER trg_kernel_post_diff_risk_assessments_no_truncate
  BEFORE TRUNCATE ON kernel_post_diff_risk_assessments
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_post_diff_risk_ledger_append_only();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('373', 'Kernel post-diff risk and human review proof', NOW())
ON CONFLICT (version) DO NOTHING;
