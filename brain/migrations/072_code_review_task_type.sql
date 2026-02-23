-- Migration 072: 添加 code_review 到 tasks task_type 约束
--
-- 背景：daily-review-scheduler.js 每天 02:00 UTC 为活跃 repo 创建 code_review task，
-- 但 tasks_task_type_check 约束不含此类型，导致插入失败。
--
-- 本 migration 修复该约束，使每日代码审查调度正常运行。

-- ============================================================
-- 1. 重建 task_type 约束（加入 code_review）
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
    'code_review',
    'initiative_plan',
    'initiative_verify',
    'dept_heartbeat'
  ));

-- ============================================================
-- 2. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('072', 'tasks task_type 约束加入 code_review，支持每日代码审查自动调度')
ON CONFLICT (version) DO NOTHING;
