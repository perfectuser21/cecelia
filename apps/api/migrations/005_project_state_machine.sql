-- Migration: Project State Machine
-- Add planning, reviewing, completed to valid project statuses

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status = ANY(ARRAY['planning', 'active', 'reviewing', 'completed', 'archived', 'paused']));

-- Update existing 'active' projects to keep them as 'active' (no change needed)
-- New projects will default to 'planning'
