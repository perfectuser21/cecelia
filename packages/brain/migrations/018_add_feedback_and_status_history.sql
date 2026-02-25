-- Add feedback and status tracking fields to tasks table
-- Migration 018: Add feedback and status_history support

-- Add feedback field (JSONB array, stores multiple feedback reports)
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS feedback JSONB DEFAULT '[]'::jsonb;

-- Add status_history field (JSONB array, records status changes)
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'::jsonb;

-- Add feedback_count field (cached count for performance)
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS feedback_count INTEGER DEFAULT 0;

-- Create GIN indexes for JSONB fields to support efficient queries
CREATE INDEX IF NOT EXISTS idx_tasks_feedback 
ON tasks USING gin(feedback);

CREATE INDEX IF NOT EXISTS idx_tasks_status_history 
ON tasks USING gin(status_history);

-- Create index on feedback_count for quick filtering
CREATE INDEX IF NOT EXISTS idx_tasks_feedback_count 
ON tasks(feedback_count);

-- Add comment explaining the feedback field structure
COMMENT ON COLUMN tasks.feedback IS 'JSONB array of feedback reports: [{"id": "uuid", "status": "completed|failed", "summary": "...", "metrics": {...}, "artifacts": {...}, "received_at": "ISO8601"}]';

-- Add comment explaining the status_history field structure
COMMENT ON COLUMN tasks.status_history IS 'JSONB array of status changes: [{"from": "pending", "to": "in_progress", "changed_at": "ISO8601", "source": "engine|brain", "metadata": {...}}]';

-- Rollback script (commented out, uncomment to rollback)
/*
ALTER TABLE tasks DROP COLUMN IF EXISTS feedback;
ALTER TABLE tasks DROP COLUMN IF EXISTS status_history;
ALTER TABLE tasks DROP COLUMN IF EXISTS feedback_count;
DROP INDEX IF EXISTS idx_tasks_feedback;
DROP INDEX IF EXISTS idx_tasks_status_history;
DROP INDEX IF EXISTS idx_tasks_feedback_count;
*/
