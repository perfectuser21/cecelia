-- Add contributes_to_kr_id to projects table
-- This links Projects to Key Results (execution layer → OKR layer)

ALTER TABLE projects ADD COLUMN IF NOT EXISTS contributes_to_kr_id UUID REFERENCES key_results(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_contributes_to_kr_id ON projects(contributes_to_kr_id);
