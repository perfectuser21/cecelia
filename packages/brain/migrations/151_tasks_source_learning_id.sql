-- Migration 150: Add source_learning_id to tasks table
-- Links a task back to the cortex insight (learning) that triggered its creation

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_learning_id VARCHAR(36);

COMMENT ON COLUMN tasks.source_learning_id IS 'ID of the cortex_insight learning that triggered this task (insight-action-bridge)';

CREATE INDEX IF NOT EXISTS idx_tasks_source_learning_id ON tasks(source_learning_id) WHERE source_learning_id IS NOT NULL;
