-- 回滚 468：删三个 Notion 记账列与版本行（投影记账丢失，重放 468 后下一轮推送会重新建页）。
BEGIN;
ALTER TABLE task_runs DROP COLUMN IF EXISTS notion_digest;
ALTER TABLE task_runs DROP COLUMN IF EXISTS notion_synced_at;
ALTER TABLE task_runs DROP COLUMN IF EXISTS notion_id;
DELETE FROM schema_version WHERE version = '468';
COMMIT;
