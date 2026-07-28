-- Migration 372: exact-SHA Kernel merge authority and effect receipts.
--
-- Every row is immutable. A merge is authorized for one observed PR head,
-- creates one durable effect intent, and is complete only after a separate
-- observation confirms that GitHub merged that same head.

CREATE TABLE IF NOT EXISTS kernel_pr_ownership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  repository TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  pr_url TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_kernel_pr_ownership_run UNIQUE (run_id),
  CONSTRAINT uq_kernel_pr_ownership_pr UNIQUE (repository, pr_number)
);

CREATE TABLE IF NOT EXISTS kernel_pr_head_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ownership_id UUID NOT NULL REFERENCES kernel_pr_ownership(id),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  head_sha TEXT NOT NULL CHECK (
    char_length(head_sha) = 40
    AND head_sha = lower(head_sha)
    AND head_sha ~ '^[0-9a-f]+$'
  ),
  head_ref TEXT NOT NULL,
  pr_state TEXT NOT NULL CHECK (pr_state IN ('OPEN', 'CLOSED', 'MERGED')),
  ci_status TEXT NOT NULL CHECK (
    ci_status IN ('pass', 'fail', 'pending', 'cancelled', 'skipped', 'unknown')
  ),
  merged BOOLEAN NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kernel_pr_head_observations_run
  ON kernel_pr_head_observations (run_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS kernel_merge_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ownership_id UUID NOT NULL REFERENCES kernel_pr_ownership(id),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  repository TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  pr_url TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  head_sha TEXT NOT NULL CHECK (
    char_length(head_sha) = 40
    AND head_sha = lower(head_sha)
    AND head_sha ~ '^[0-9a-f]+$'
  ),
  policy_version TEXT NOT NULL,
  evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_kernel_merge_authorization
    UNIQUE (ownership_id, head_sha, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_kernel_merge_authorizations_run
  ON kernel_merge_authorizations (run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kernel_merge_effect_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id UUID NOT NULL UNIQUE REFERENCES kernel_merge_authorizations(id),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  effect_kind TEXT NOT NULL DEFAULT 'github_pr_squash_merge'
    CHECK (effect_kind = 'github_pr_squash_merge'),
  target TEXT NOT NULL,
  requested_head_sha TEXT NOT NULL CHECK (
    char_length(requested_head_sha) = 40
    AND requested_head_sha = lower(requested_head_sha)
    AND requested_head_sha ~ '^[0-9a-f]+$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kernel_merge_effect_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES kernel_merge_effect_intents(id),
  receipt_status TEXT NOT NULL
    CHECK (receipt_status IN ('confirmed', 'failed', 'observed_not_merged')),
  observed_head_sha TEXT NOT NULL CHECK (
    char_length(observed_head_sha) = 40
    AND observed_head_sha = lower(observed_head_sha)
    AND observed_head_sha ~ '^[0-9a-f]+$'
  ),
  merged BOOLEAN NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (receipt_status = 'confirmed' AND merged)
    OR (receipt_status <> 'confirmed' AND NOT merged)
  )
);

CREATE INDEX IF NOT EXISTS idx_kernel_merge_effect_receipts_intent
  ON kernel_merge_effect_receipts (intent_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_merge_receipt_confirmed
  ON kernel_merge_effect_receipts (intent_id)
  WHERE receipt_status = 'confirmed';

CREATE OR REPLACE FUNCTION kernel_merge_ledger_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'kernel merge ledger is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_pr_ownership_append_only ON kernel_pr_ownership;
CREATE TRIGGER trg_kernel_pr_ownership_append_only
  BEFORE UPDATE OR DELETE ON kernel_pr_ownership
  FOR EACH ROW EXECUTE FUNCTION kernel_merge_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_pr_head_observations_append_only ON kernel_pr_head_observations;
CREATE TRIGGER trg_kernel_pr_head_observations_append_only
  BEFORE UPDATE OR DELETE ON kernel_pr_head_observations
  FOR EACH ROW EXECUTE FUNCTION kernel_merge_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_merge_authorizations_append_only ON kernel_merge_authorizations;
CREATE TRIGGER trg_kernel_merge_authorizations_append_only
  BEFORE UPDATE OR DELETE ON kernel_merge_authorizations
  FOR EACH ROW EXECUTE FUNCTION kernel_merge_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_merge_effect_intents_append_only ON kernel_merge_effect_intents;
CREATE TRIGGER trg_kernel_merge_effect_intents_append_only
  BEFORE UPDATE OR DELETE ON kernel_merge_effect_intents
  FOR EACH ROW EXECUTE FUNCTION kernel_merge_ledger_append_only();

DROP TRIGGER IF EXISTS trg_kernel_merge_effect_receipts_append_only ON kernel_merge_effect_receipts;
CREATE TRIGGER trg_kernel_merge_effect_receipts_append_only
  BEFORE UPDATE OR DELETE ON kernel_merge_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_merge_ledger_append_only();
