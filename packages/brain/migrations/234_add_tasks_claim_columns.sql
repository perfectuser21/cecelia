-- Migration 234: Tasks claim 语义，防止并行 dispatch 重复派发
-- 根因：dispatcher 从 queued 选任务 → 标 in_progress 不是原子操作，
--       多 tick 之间或多 runner 之间可能重复选中同一任务（如 task 75c0e524 产出 #2372/#2373 重复 PR）
-- 解决：tasks 表增加 claimed_by / claimed_at 两列，提供 atomic UPDATE 保证同时只能被一个 runner claim

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- 索引：加速 dispatch 选任务时的过滤（只索引已 claim 的行，节省空间）
CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by
  ON tasks(claimed_by) WHERE claimed_by IS NOT NULL;

-- 回滚（dev 环境不自动跑，手动 psql 执行）：
--   DROP INDEX IF EXISTS idx_tasks_claimed_by;
--   ALTER TABLE tasks DROP COLUMN IF EXISTS claimed_by, DROP COLUMN IF EXISTS claimed_at;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('234', 'Tasks claim 语义：claimed_by/claimed_at 列 + 部分索引，防止并行 dispatch 重复', NOW())
ON CONFLICT (version) DO NOTHING;
