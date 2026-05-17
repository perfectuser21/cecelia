-- migration 165: 添加 Pipeline v2 Gate 任务类型到 tasks_task_type_check
-- 新增: spec_review, code_review_gate, prd_review, initiative_review, initiative_execute
-- 幂等设计，重复执行安全

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
    'prd_review', 'initiative_review', 'initiative_execute'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('165', 'add Pipeline v2 Gate task_types: spec_review, code_review_gate, prd_review, initiative_review, initiative_execute', NOW())
ON CONFLICT (version) DO NOTHING;
