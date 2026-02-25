-- Migration 004: Planner Agent tables
-- Adds prd_content and scope to projects, creates project_kr_links

ALTER TABLE projects ADD COLUMN IF NOT EXISTS prd_content TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scope TEXT;

CREATE TABLE IF NOT EXISTS project_kr_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  kr_id UUID REFERENCES goals(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, kr_id)
);

CREATE INDEX IF NOT EXISTS idx_project_kr_links_project ON project_kr_links(project_id);
CREATE INDEX IF NOT EXISTS idx_project_kr_links_kr ON project_kr_links(kr_id);
