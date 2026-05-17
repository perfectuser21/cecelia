-- Migration 070: 添加 dept_heartbeat 到 tasks task_type 约束
--
-- 背景：executor.js 已支持 dept_heartbeat → /repo-lead heartbeat，
-- dept-heartbeat.js 每次 tick 触发时尝试创建 dept_heartbeat 任务，
-- 但 tasks_task_type_check 约束不含此类型，导致插入失败。
--
-- 本 migration 修复该约束，使 heartbeat 调度正常运行。

-- ============================================================
-- 1. 重建 task_type 约束（加入 dept_heartbeat）
-- ============================================================
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;

ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN (
    'dev',
    'review',
    'talk',
    'data',
    'research',
    'exploratory',
    'qa',
    'audit',
    'decomp_review',
    'codex_qa',
    'initiative_plan',
    'initiative_verify',
    'dept_heartbeat'
  ));

-- ============================================================
-- 2. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('070', 'tasks task_type 约束加入 dept_heartbeat，支持部门主管 heartbeat 调度')
ON CONFLICT (version) DO NOTHING;
