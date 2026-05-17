-- Migration 178: tasks 表新增 okr_initiative_id 字段
-- 用途：连接 tasks → okr_initiatives → okr_scopes → okr_projects → key_results
-- 形成完整进度追踪链

BEGIN;

-- 新增字段
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS okr_initiative_id uuid REFERENCES okr_initiatives(id);

-- 索引：快速查询某个 initiative 下的所有 tasks
CREATE INDEX IF NOT EXISTS idx_tasks_okr_initiative_id
  ON tasks(okr_initiative_id)
  WHERE okr_initiative_id IS NOT NULL;

-- 更新 schema_version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('178', 'tasks 表新增 okr_initiative_id 字段，连接7层OKR进度追踪链', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
