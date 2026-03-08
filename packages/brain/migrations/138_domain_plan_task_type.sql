-- Migration 138: 扩展 tasks_task_type_check — 加入 domain_plan
-- planner.js 的 generateArchitectureDesignTask 对 non-coding domain 使用 task_type='domain_plan'
-- executor.js 的 skillMap 已有 domain_plan → /decomp 路由
-- 但约束中没有该值，导致 INSERT 失败

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
