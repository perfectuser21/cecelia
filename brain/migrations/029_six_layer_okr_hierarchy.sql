-- Migration 029: 6-Layer OKR Hierarchy
-- Global OKR → Area OKR → KR → Project → Initiative → Task
--
-- Changes:
-- 1. goals.type: expand from objective/key_result to global_okr/area_okr/kr
-- 2. projects: add type column (project/initiative) + plan_content
-- 3. project_repos: many-to-many for Project ↔ Repository
-- 4. Fix broken views (pr_plan_full_context, initiative_pr_progress)

-- 1. Migrate goals.type values
-- Top-level objectives (parent_id IS NULL) → global_okr
UPDATE goals SET type = 'global_okr' WHERE type = 'objective' AND parent_id IS NULL;
-- Nested objectives (parent_id IS NOT NULL) → area_okr
UPDATE goals SET type = 'area_okr' WHERE type = 'objective' AND parent_id IS NOT NULL;
-- key_result → kr
UPDATE goals SET type = 'kr' WHERE type = 'key_result';

-- 2. Projects: add type column
ALTER TABLE projects ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'project';
-- Classify existing: has parent_id → initiative, otherwise → project
UPDATE projects SET type = 'initiative' WHERE parent_id IS NOT NULL;
UPDATE projects SET type = 'project' WHERE parent_id IS NULL;

-- 3. Projects: add plan_content for Initiative plans
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_content TEXT;

-- 4. project_repos: many-to-many (Project can span multiple repos)
CREATE TABLE IF NOT EXISTS project_repos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo_path TEXT NOT NULL,
    role TEXT DEFAULT 'primary',
    created_at timestamptz DEFAULT NOW(),
    UNIQUE(project_id, repo_path)
);

-- Migrate existing repo_path data into project_repos
INSERT INTO project_repos (project_id, repo_path)
SELECT id, repo_path FROM projects WHERE repo_path IS NOT NULL
ON CONFLICT DO NOTHING;

-- 5. Fix broken views that reference deleted features table
DROP VIEW IF EXISTS pr_plan_full_context;
DROP VIEW IF EXISTS initiative_pr_progress;

CREATE OR REPLACE VIEW pr_plan_full_context AS
SELECT
    pp.id AS pr_plan_id,
    pp.title AS pr_plan_title,
    pp.dod, pp.files, pp.sequence, pp.complexity,
    pp.status AS pr_plan_status,
    p.id AS project_id,
    p.name AS project_name,
    pr.repo_path,
    pp.depends_on,
    t.id AS task_id,
    t.status AS task_status
FROM pr_plans pp
LEFT JOIN projects p ON pp.project_id = p.id
LEFT JOIN LATERAL (SELECT repo_path FROM project_repos WHERE project_id = p.id LIMIT 1) pr ON true
LEFT JOIN tasks t ON t.pr_plan_id = pp.id;

CREATE OR REPLACE VIEW initiative_pr_progress AS
SELECT
    i.id AS initiative_id,
    i.name AS initiative_title,
    COUNT(pp.id) AS total_prs,
    COUNT(CASE WHEN pp.status = 'completed' THEN 1 END) AS completed_prs,
    COUNT(CASE WHEN pp.status = 'in_progress' THEN 1 END) AS in_progress_prs,
    COUNT(CASE WHEN pp.status = 'planning' THEN 1 END) AS planning_prs,
    CASE WHEN COUNT(pp.id) = 0 THEN 0
         ELSE ROUND(100.0 * COUNT(CASE WHEN pp.status = 'completed' THEN 1 END) / COUNT(pp.id))
    END AS progress_percentage
FROM projects i
LEFT JOIN pr_plans pp ON i.id = pp.project_id
WHERE i.type = 'initiative'
GROUP BY i.id, i.name;

-- 6. Schema version
INSERT INTO schema_version (version, description)
VALUES ('029', '6-layer OKR hierarchy: global_okr/area_okr/kr + project/initiative types + project_repos')
ON CONFLICT (version) DO NOTHING;
