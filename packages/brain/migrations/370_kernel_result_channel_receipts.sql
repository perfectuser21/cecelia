-- Migration 370: durable, append-only Kernel Fleet result receipts.

ALTER TABLE harness_attempts
  ADD COLUMN IF NOT EXISTS result_receipt_id UUID,
  ADD COLUMN IF NOT EXISTS result_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS result_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS result_delivery_id UUID,
  ADD COLUMN IF NOT EXISTS result_nonce UUID,
  ADD COLUMN IF NOT EXISTS result_worker_id TEXT,
  ADD COLUMN IF NOT EXISTS result_persisted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS harness_result_receipts (
  receipt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES harness_attempts(id) ON DELETE RESTRICT,
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  requested_provider TEXT NOT NULL,
  provider_session_id TEXT,
  skill_name TEXT,
  skill_version TEXT,
  skill_digest TEXT,
  task_bundle_sha256 TEXT NOT NULL CHECK (task_bundle_sha256 ~ '^[a-f0-9]{64}$'),
  result_authority_sha256 TEXT NOT NULL
    CHECK (result_authority_sha256 ~ '^[a-f0-9]{64}$'),
  result_authority JSONB NOT NULL,
  worker_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_generation INTEGER NOT NULL CHECK (lease_generation >= 0),
  delivery_id UUID NOT NULL UNIQUE,
  result_nonce UUID NOT NULL,
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~ '^[a-f0-9]{64}$'),
  result_bytes INTEGER NOT NULL CHECK (result_bytes > 0 AND result_bytes <= 1048576),
  terminal_status TEXT NOT NULL CHECK (
    terminal_status IN (
      'completed','completed_with_concerns','needs_context','blocked','failed','cancelled'
    )
  ),
  result JSONB NOT NULL,
  persisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id),
  UNIQUE (attempt_id, lease_generation),
  UNIQUE (attempt_id, lease_generation, result_nonce)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_harness_attempts_result_receipt
  ON harness_attempts (result_receipt_id)
  WHERE result_receipt_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'harness_attempts_result_receipt_fk'
       AND conrelid = 'harness_attempts'::regclass
  ) THEN
    ALTER TABLE harness_attempts
      ADD CONSTRAINT harness_attempts_result_receipt_fk
      FOREIGN KEY (result_receipt_id)
      REFERENCES harness_result_receipts(receipt_id)
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_harness_result_receipts_run
  ON harness_result_receipts (run_id, persisted_at DESC);

CREATE OR REPLACE FUNCTION harness_result_receipts_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'harness_result_receipts is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_harness_result_receipts_append_only
  ON harness_result_receipts;
CREATE TRIGGER trg_harness_result_receipts_append_only
  BEFORE UPDATE OR DELETE ON harness_result_receipts
  FOR EACH ROW EXECUTE FUNCTION harness_result_receipts_append_only();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('370', 'Durable Kernel result channel receipts', NOW())
ON CONFLICT (version) DO NOTHING;
