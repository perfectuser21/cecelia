-- Migration 128: 任务执行成功率监控基础设施
-- 为 tasks 表添加执行指标字段，用于追踪「dev 任务 → PR 合并」端到端成功率

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS execution_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS pr_url TEXT,
  ADD COLUMN IF NOT EXISTS pr_merged_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS success_metrics JSONB;

-- 索引：用于 pr-merged 统计（快速查找已合并任务）
CREATE INDEX IF NOT EXISTS idx_tasks_pr_merged_at ON tasks (pr_merged_at) WHERE pr_merged_at IS NOT NULL;

-- 索引：用于 success-rate 统计（按时间范围过滤）
CREATE INDEX IF NOT EXISTS idx_tasks_created_at_type ON tasks (created_at, task_type);
