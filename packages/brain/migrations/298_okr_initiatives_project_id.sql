-- Migration 298: 折叠 Scope — okr_initiatives 直挂 Project
-- 双轴模型执行轴收敛为 3 层 Project→Initiative→Task；Initiative 不再经 Scope 中转。
-- project_id 从 scope 回填（okr_initiatives.scope_id → okr_scopes.project_id）；无 scope 的留 NULL。
-- 注：仅加列 + 回填，scope_id 列与 okr_scopes 表暂留（50 文件仍引用，Phase 2b 改完才删）。
-- 参见 docs/superpowers/specs/2026-06-10-canonical-wbs-tree-design.md §5 / decisions 99ce3259

ALTER TABLE okr_initiatives
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES okr_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_okr_initiatives_project_id ON okr_initiatives(project_id);

-- 回填：经 scope 推出 project（覆盖有 scope 的约 336 行）
UPDATE okr_initiatives i
SET project_id = s.project_id
FROM okr_scopes s
WHERE i.scope_id = s.id
  AND i.project_id IS NULL
  AND s.project_id IS NOT NULL;
