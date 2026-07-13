-- Migration 340: 派发前判重（dispatcher.js _internals_findDuplicateTaskSibling）查询索引
-- 该查询按 (task_type, status IN ('queued','in_progress'), created_at BETWEEN ...) 过滤，
-- 现有索引未覆盖此组合，随 tasks 表增长会全表/低选择性扫描拖慢每次 dispatch tick。
-- 部分索引：只覆盖 queued/in_progress 两态（判重只关心"正在办的"），比全量索引更小更快。
-- 幂等：IF NOT EXISTS 守卫，重复执行安全。
CREATE INDEX IF NOT EXISTS idx_tasks_dedup_lookup
  ON tasks (task_type, status, created_at)
  WHERE status IN ('queued','in_progress');
