-- Migration 113: 扩展 tasks_task_type_check — 加入 notion_synced
-- notion-full-sync.js 的 upsertTask 使用 task_type='notion_synced'
-- 但约束中没有该值，导致 ON CONFLICT INSERT 失败

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory',
    'qa', 'audit', 'decomp_review', 'codex_qa',
    'code_review', 'initiative_plan', 'initiative_verify',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced'
  )
);

INSERT INTO schema_version (version, description)
VALUES ('114', 'Add notion_synced to tasks_task_type_check constraint')
ON CONFLICT (version) DO NOTHING;
