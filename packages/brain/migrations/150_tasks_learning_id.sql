-- Migration 150: Add learning_id to tasks table
-- Purpose: Link tasks created from cortex_insight learnings to their source learning
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS learning_id UUID REFERENCES learnings(id);

CREATE INDEX IF NOT EXISTS idx_tasks_learning_id ON tasks (learning_id) WHERE learning_id IS NOT NULL;
