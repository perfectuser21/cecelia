-- Migration 371: durable, replay-safe Kernel Fleet heartbeat receipts.
--
-- Receipts are deliberately append-only. Expired lease timestamps remain
-- audit evidence and keep a nonce consumed for the lifetime of its Attempt
-- generation; no online retention job deletes these rows.

CREATE TABLE IF NOT EXISTS harness_heartbeat_receipts (
  receipt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES harness_attempts(id) ON DELETE RESTRICT,
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE RESTRICT,
  worker_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_generation INTEGER NOT NULL CHECK (lease_generation >= 0),
  heartbeat_nonce UUID NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at TIMESTAMPTZ NOT NULL,
  lease_seconds INTEGER NOT NULL CHECK (lease_seconds >= 30 AND lease_seconds <= 600),
  provider_session_id TEXT,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  persisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, lease_generation, heartbeat_nonce)
);

CREATE INDEX IF NOT EXISTS idx_harness_heartbeat_receipts_run
  ON harness_heartbeat_receipts (run_id, persisted_at DESC);

CREATE INDEX IF NOT EXISTS idx_harness_heartbeat_receipts_lease_expiry
  ON harness_heartbeat_receipts (lease_expires_at DESC);

CREATE OR REPLACE FUNCTION harness_heartbeat_receipts_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'harness_heartbeat_receipts is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_harness_heartbeat_receipts_append_only
  ON harness_heartbeat_receipts;
CREATE TRIGGER trg_harness_heartbeat_receipts_append_only
  BEFORE UPDATE OR DELETE ON harness_heartbeat_receipts
  FOR EACH ROW EXECUTE FUNCTION harness_heartbeat_receipts_append_only();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('371', 'Durable replay-safe Kernel heartbeat receipts', NOW())
ON CONFLICT (version) DO NOTHING;
