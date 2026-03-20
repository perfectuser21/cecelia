-- Migration 167: Add scope_plan and project_plan task types
-- Required for Scope layer flywheel (Project→Scope→Initiative)

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
    'scope_plan', 'project_plan'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('167', 'add scope_plan and project_plan task_types for Scope layer flywheel', NOW())
ON CONFLICT (version) DO NOTHING;
