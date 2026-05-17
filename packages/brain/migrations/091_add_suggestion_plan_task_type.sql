-- Migration 091: 扩展 task_type CHECK 约束，加入 suggestion_plan
-- PR #111 新增 suggestion-dispatcher.js，创建 task_type='suggestion_plan' 任务，
-- 但约束未更新，导致 INSERT 失败。

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory',
    'qa', 'audit', 'decomp_review', 'codex_qa',
    'code_review', 'initiative_plan', 'initiative_verify',
    'dept_heartbeat', 'suggestion_plan'
  )
);

INSERT INTO schema_version (version, description)
VALUES ('091', 'Add suggestion_plan to tasks_task_type_check constraint')
ON CONFLICT (version) DO NOTHING;
