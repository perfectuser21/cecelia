-- Migration 132: tasks 表添加 pr_status 字段
-- 追踪 PR 生命周期：open → ci_pending → ci_passed/ci_failed → merged/closed
-- 配合 PR Shepherd（牧羊人）机制实现 CI 通过后自动合并

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS pr_status TEXT
    CHECK (pr_status IN ('open', 'ci_pending', 'ci_passed', 'ci_failed', 'merged', 'closed'));

-- 为已有 pr_url 且 pr_merged_at IS NOT NULL 的任务回填 pr_status = 'merged'
UPDATE tasks
  SET pr_status = 'merged'
  WHERE pr_url IS NOT NULL
    AND pr_merged_at IS NOT NULL
    AND pr_status IS NULL;

-- 为已有 pr_url 且 pr_merged_at IS NULL 且 status 非终态的任务回填 pr_status = 'open'
UPDATE tasks
  SET pr_status = 'open'
  WHERE pr_url IS NOT NULL
    AND pr_merged_at IS NULL
    AND pr_status IS NULL
    AND status NOT IN ('completed', 'failed', 'quarantined', 'cancelled');

-- 索引：Shepherd 查询 open/ci_pending 任务（每次 tick 使用）
CREATE INDEX IF NOT EXISTS idx_tasks_pr_status ON tasks (pr_status) WHERE pr_status IS NOT NULL;

INSERT INTO schema_version (version, description)
  VALUES ('132', 'tasks.pr_status: PR 生命周期追踪字段');
