-- Migration 169: projects.current_phase 约束修正 + active 项目回填
-- Version: 169
-- Date: 2026-03-21
-- Description: 修正 current_phase CHECK 约束（去掉 plan），根据 sequence_order 回填 active projects

-- 1. 修正 CHECK 约束：去掉 'plan'，只允许 now / next / later / null
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_phase_check;
ALTER TABLE projects ADD CONSTRAINT projects_phase_check
  CHECK (current_phase IN ('now', 'next', 'later') OR current_phase IS NULL);

-- 2. 回填现有 active projects 的 current_phase（根据 sequence_order）
--    sequence_order = 1   → 'now'
--    sequence_order = 2   → 'next'
--    sequence_order >= 3  → 'later'
--    sequence_order IS NULL → 不设（保持 NULL）
UPDATE projects
SET current_phase = CASE
  WHEN sequence_order = 1 THEN 'now'
  WHEN sequence_order = 2 THEN 'next'
  WHEN sequence_order >= 3 THEN 'later'
END,
updated_at = NOW()
WHERE status = 'active'
  AND sequence_order IS NOT NULL
  AND current_phase IS NULL;

-- 3. schema version
INSERT INTO schema_version (version, description)
VALUES ('169', 'Fix current_phase CHECK constraint (drop plan), backfill active projects from sequence_order')
ON CONFLICT (version) DO NOTHING;
