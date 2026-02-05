-- Migration: Add trigger_source column to tasks table
-- Purpose: Track whether task was triggered automatically (headless) or manually (headed)

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(20) DEFAULT 'auto';

COMMENT ON COLUMN tasks.trigger_source IS 'auto = headless from tick, manual = headed interactive session';

-- Index for filtering by trigger source
CREATE INDEX IF NOT EXISTS idx_tasks_trigger_source ON tasks(trigger_source);
