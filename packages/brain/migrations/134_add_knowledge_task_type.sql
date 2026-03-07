-- Migration 134: Add 'knowledge' to tasks.task_type CHECK constraint
-- Required for domain=knowledge planner routing (generateArchitectureDesignTask domain-aware routing)

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;

ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory', 'qa', 'audit',
    'decomp_review', 'codex_qa', 'code_review', 'initiative_plan', 'initiative_verify',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced', 'architecture_design',
    'knowledge'
  )
);
