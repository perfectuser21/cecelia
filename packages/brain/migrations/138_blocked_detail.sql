-- Migration 138: tasks 表添加 blocked_detail JSONB 字段
-- 存储阻塞的详细信息（类型、依赖关系等）

-- 添加 blocked_detail 字段
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS blocked_detail JSONB;

-- 索引：按 blocked_detail.type 查询
CREATE INDEX IF NOT EXISTS idx_tasks_blocked_detail_type
  ON tasks ((blocked_detail->>'type'))
  WHERE status = 'blocked' AND blocked_detail IS NOT NULL;

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('138', 'tasks blocked_detail JSONB 字段 + dependency 索引', NOW())
ON CONFLICT (version) DO NOTHING;
