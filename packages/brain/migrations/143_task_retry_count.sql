-- Migration 143: Add retry_count to tasks table
-- Tracks how many times a timed-out task has been requeued.
-- When retry_count >= 3, the task is quarantined instead of requeued.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Schema version
INSERT INTO schema_version (version, description) VALUES ('143', 'Add retry_count to tasks table for timeout requeue logic');
