-- Migration 168: Add pipeline_rescue and content_publish task types + clean zombie tasks
-- pipeline_rescue: Pipeline Patrol 创建的救援任务
-- content_publish: 内容发布系统的发布任务
-- 同时清理空 description 的 queued 僵尸任务

-- 1. 更新 CHECK 约束：新增 pipeline_rescue 和 content_publish
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type = ANY (ARRAY[
    'dev', 'review', 'talk', 'data', 'research',
    'exploratory', 'explore', 'knowledge',
    'qa', 'audit', 'decomp_review',
    'codex_qa', 'codex_dev', 'codex_playwright',
    'pr_review',
    'code_review', 'initiative_plan', 'initiative_verify',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session',
    'intent_expand', 'cto_review',
    -- Pipeline v2 Gate 类型
    'spec_review', 'code_review_gate',
    'prd_review', 'initiative_review', 'initiative_execute',
    -- Scope 层飞轮（Project→Scope→Initiative）
    'scope_plan', 'project_plan',
    -- Pipeline Patrol + Content Publish
    'pipeline_rescue', 'content_publish'
  ])
);

-- 2. 清理空 description 的 queued 僵尸任务（pre-flight 拒绝派发这些任务）
UPDATE tasks
SET status = 'cancelled',
    updated_at = NOW()
WHERE status = 'queued'
  AND (description IS NULL OR TRIM(description) = '');

INSERT INTO schema_version (version, description, applied_at)
VALUES ('168', 'add pipeline_rescue and content_publish task_types, clean empty-description queued tasks', NOW())
ON CONFLICT (version) DO NOTHING;
