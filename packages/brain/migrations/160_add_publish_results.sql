-- Migration 160: Add publish_results table
-- 幂等设计，重复执行安全

-- 1. 创建 publish_results 表
CREATE TABLE IF NOT EXISTS publish_results (
  id          BIGSERIAL PRIMARY KEY,
  platform    TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'unknown',
  work_id     TEXT,
  url         TEXT,
  success     BOOLEAN NOT NULL,
  error       TEXT,
  title       TEXT,
  task_id     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 索引
CREATE INDEX IF NOT EXISTS publish_results_platform_idx ON publish_results (platform);
CREATE INDEX IF NOT EXISTS publish_results_created_at_idx ON publish_results (created_at DESC);
CREATE INDEX IF NOT EXISTS publish_results_task_id_idx ON publish_results (task_id) WHERE task_id IS NOT NULL;

-- 3. 记录版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('160', 'add publish_results table for cross-platform publish tracking', NOW())
ON CONFLICT (version) DO NOTHING;
