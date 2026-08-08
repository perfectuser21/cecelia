-- Migration 394: callback_queue single-consumer lease
-- HTTP callback 与 callback-worker 共享同一队列时，以数据库租约避免双消费。

ALTER TABLE callback_queue
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_callback_queue_claimable
  ON callback_queue (claimed_at ASC, created_at ASC)
  WHERE processed_at IS NULL;
