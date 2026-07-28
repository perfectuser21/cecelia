-- Migration 373: server-authoritative post-diff risk and production behavior proof.

CREATE TABLE IF NOT EXISTS kernel_behavior_production_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (receipt_status = 'confirmed'),
  behavior_version TEXT NOT NULL,
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
  deployed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > deployed_at),
  CONSTRAINT uq_kernel_behavior_production_receipt
    UNIQUE (
      behavior_version,
      production_head_sha,
      contract_digest,
      path_class
    )
);

CREATE INDEX IF NOT EXISTS idx_kernel_behavior_production_receipts_lookup
  ON kernel_behavior_production_receipts
    (behavior_version, deployed_at DESC)
  WHERE receipt_status = 'confirmed';

CREATE TABLE IF NOT EXISTS kernel_post_diff_risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  assessment_hop INTEGER NOT NULL CHECK (assessment_hop > 0),
  head_sha TEXT NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  diff_hash TEXT NOT NULL CHECK (diff_hash ~ '^sha256:[0-9a-f]{64}$'),
  contract_version INTEGER NOT NULL CHECK (contract_version > 0),
  contract_digest TEXT NOT NULL CHECK (
    contract_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  behavior_version TEXT NOT NULL,
  path_class TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  human_review_required BOOLEAN NOT NULL,
  auto_eligible BOOLEAN NOT NULL,
  policy_version TEXT NOT NULL,
  proof_expires_at TIMESTAMPTZ NOT NULL,
  evidence JSONB NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    NOT auto_eligible
    OR (risk_level = 'low' AND NOT human_review_required)
  ),
  CONSTRAINT uq_kernel_post_diff_risk_assessment
    UNIQUE (run_id, head_sha, diff_hash, contract_digest, policy_version)
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

DROP TRIGGER IF EXISTS trg_kernel_post_diff_risk_assessments_append_only
  ON kernel_post_diff_risk_assessments;
CREATE TRIGGER trg_kernel_post_diff_risk_assessments_append_only
  BEFORE UPDATE OR DELETE ON kernel_post_diff_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION kernel_post_diff_risk_ledger_append_only();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('373', 'Kernel post-diff risk and human review proof', NOW())
ON CONFLICT (version) DO NOTHING;
