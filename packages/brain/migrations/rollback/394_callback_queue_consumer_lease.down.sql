DROP INDEX IF EXISTS idx_callback_queue_claimable;

ALTER TABLE callback_queue
  DROP COLUMN IF EXISTS claimed_by,
  DROP COLUMN IF EXISTS claimed_at;
