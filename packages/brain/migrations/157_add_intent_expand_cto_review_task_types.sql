-- migration 157: 新增 intent_expand + cto_review task_type CHECK 约束
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
    'intent_expand', 'cto_review'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('157', 'add intent_expand + cto_review task_type constraint', NOW())
ON CONFLICT (version) DO NOTHING;
