-- 清理所有 quarantined 的 dept_heartbeat 任务
-- 将它们标记为 canceled，防止占用防重复检查槽位
-- 执行方式: psql -d cecelia -f scripts/cleanup-quarantined-heartbeat.sql

UPDATE tasks
SET status = 'canceled',
    updated_at = NOW(),
    summary = '自动清理：quarantined heartbeat 任务批量取消'
WHERE task_type = 'dept_heartbeat'
  AND status = 'quarantined';
