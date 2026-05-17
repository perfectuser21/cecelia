-- Migration 154: sync tasks.task_type check constraint with task-router.js VALID_TASK_TYPES
-- PR #998 added codex_playwright to task-router.js but missed this DB migration.
-- Also adds 'explore' and 'knowledge' which were in VALID_TASK_TYPES but not in the constraint.
-- Keeps legacy 'exploratory' and 'notion_synced' for backwards compatibility with existing tasks.

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;

ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type = ANY (ARRAY[
    'dev', 'review', 'talk', 'data', 'research',
    'exploratory', 'explore', 'knowledge',
    'qa', 'audit', 'decomp_review',
    'codex_qa', 'codex_dev', 'codex_playwright',
    'code_review', 'initiative_plan', 'initiative_verify',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('154', 'sync task_type check constraint: add codex_playwright, explore, knowledge', NOW())
ON CONFLICT (version) DO NOTHING;
