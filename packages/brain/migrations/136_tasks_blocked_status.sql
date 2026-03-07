-- Migration 136: tasks 表新增 blocked 状态字段
-- tasks.status 已使用 VARCHAR(50) 无 CHECK 约束，无需修改 status 列
-- 新增三个 blocked 相关字段

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_by TEXT;

-- 记录 migration 版本
INSERT INTO schema_version (version, description)
VALUES ('136', 'tasks 表新增 blocked_reason/blocked_at/blocked_by 字段')
ON CONFLICT (version) DO NOTHING;
