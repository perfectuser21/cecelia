-- Migration 377: durable idempotency for Kernel Codex review callbacks.
--
-- Ordinary callback producers remain backward compatible because the new key
-- is nullable. Kernel Codex review uses one stable key per task/run and a
-- fail-dominant UPSERT, so a crash/retry cannot create competing terminal
-- verdict rows.

ALTER TABLE callback_queue
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_callback_queue_idempotency_key
  ON callback_queue (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('377', 'Kernel Codex review callback idempotency', NOW())
ON CONFLICT (version) DO NOTHING;
