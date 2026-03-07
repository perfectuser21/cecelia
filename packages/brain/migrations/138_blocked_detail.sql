-- Migration 138: tasks 表添加 blocked_detail JSONB 字段
-- 用于结构化存储阻塞原因（依赖关系、类型、自动解除标记等）
-- 补充 Migration 137 的 VARCHAR blocked_reason 字段，支持 dependency-based 自动解除

BEGIN;

-- 添加 blocked_detail JSONB 字段（可为空，仅在结构化阻塞时使用）
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS blocked_detail jsonb;

-- 索引：供 tick 扫描 dependency 类型的 blocked 任务
CREATE INDEX IF NOT EXISTS idx_tasks_blocked_detail_type
  ON tasks ((blocked_detail->>'type'))
  WHERE status = 'blocked' AND blocked_detail IS NOT NULL;

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('138', 'tasks blocked_detail JSONB 字段 + dependency 索引', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
