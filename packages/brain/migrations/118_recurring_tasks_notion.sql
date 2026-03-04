-- Migration 118: recurring_tasks Notion 同步支持
-- 新增字段：notion_page_id, executor, last_run_status

ALTER TABLE recurring_tasks
  ADD COLUMN IF NOT EXISTS notion_page_id TEXT,
  ADD COLUMN IF NOT EXISTS executor TEXT DEFAULT 'cecelia',
  ADD COLUMN IF NOT EXISTS last_run_status TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS recurring_tasks_notion_page_id_idx
  ON recurring_tasks (notion_page_id)
  WHERE notion_page_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('118') ON CONFLICT DO NOTHING;
