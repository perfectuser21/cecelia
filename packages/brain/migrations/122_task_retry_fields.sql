-- Migration 122: tasks 表添加 retry_count 和 max_retries 字段
-- 为 dev 任务执行状态监控与自动重试机制提供数据库支持

-- 1. 向 tasks 表添加 retry_count 字段（当前重试次数）
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- 2. 向 tasks 表添加 max_retries 字段（最大重试次数）
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;

-- 3. 添加索引（可能的查询场景：筛选可重试任务）
CREATE INDEX IF NOT EXISTS idx_tasks_retry_count ON tasks (retry_count)
  WHERE status = 'failed';

-- 4. 更新 schema version
INSERT INTO schema_version (version, description)
VALUES ('122', 'tasks 表添加 retry_count 和 max_retries 字段')
ON CONFLICT (version) DO NOTHING;
