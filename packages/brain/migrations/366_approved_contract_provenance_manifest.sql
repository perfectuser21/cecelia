-- Approved contract provenance manifest.
-- Freezes the reviewer-approved Git object set and stores append-only approval facts.

ALTER TABLE initiative_contracts
  ADD COLUMN IF NOT EXISTS source_commit_sha text,
  ADD COLUMN IF NOT EXISTS manifest_digest text,
  ADD COLUMN IF NOT EXISTS approved_manifest jsonb,
  ADD COLUMN IF NOT EXISTS reviewer_verdict jsonb;

CREATE TABLE IF NOT EXISTS initiative_contract_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL,
  run_id uuid NOT NULL,
  contract_version integer NOT NULL,
  source_commit_sha text NOT NULL,
  sprint_dir text NOT NULL,
  manifest_digest text NOT NULL,
  approved_manifest jsonb NOT NULL,
  reviewer_verdict jsonb NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  supersedes_approval_id uuid REFERENCES initiative_contract_approvals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (initiative_id, contract_version, manifest_digest)
);

CREATE INDEX IF NOT EXISTS idx_initiative_contract_approvals_run
  ON initiative_contract_approvals(run_id);

CREATE INDEX IF NOT EXISTS idx_initiative_contract_approvals_current
  ON initiative_contract_approvals(initiative_id, contract_version DESC, approved_at DESC);

CREATE INDEX IF NOT EXISTS idx_initiative_contract_approvals_manifest
  ON initiative_contract_approvals(manifest_digest);

CREATE UNIQUE INDEX IF NOT EXISTS idx_initiative_contract_approvals_version_conflict_guard
  ON initiative_contract_approvals(initiative_id, contract_version);
