-- Migration 138: 扩展 tasks_task_type_check — 加入 domain_plan
-- planner.js 的 generateArchitectureDesignTask 使用 task_type='domain_plan' (非 coding domain)
-- task-router.js 和 executor.js 已注册 domain_plan → /decomp
-- 需要在约束中添加该值

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory',
    'qa', 'audit', 'decomp_review', 'codex_qa',
    'code_review', 'initiative_plan', 'initiative_verify',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'domain_plan'
  )
);
