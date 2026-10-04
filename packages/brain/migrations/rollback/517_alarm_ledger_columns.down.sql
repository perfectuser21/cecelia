-- Rollback 517：撤掉闹钟总账新列。先删由新代码/导入写入的行（Brain job / recurring 落表行、
-- 盘点静态快照行），保证 ops_schedule_entries 回到 433 时代只有采集腿写入的语义；
-- 再删索引与列。采集腿（crontab/openclaw/gha/launchd）的既有行不动。
BEGIN;
DELETE FROM ops_schedule_entries
 WHERE source = 'inventory-20261004'
    OR registered_via IN ('brain-job', 'brain-loop', 'recurring');
DROP INDEX IF EXISTS idx_ops_schedule_entries_journey;
DROP INDEX IF EXISTS idx_ops_schedule_entries_ledger;
ALTER TABLE ops_schedule_entries
  DROP COLUMN IF EXISTS interval_sec,
  DROP COLUMN IF EXISTS enabled,
  DROP COLUMN IF EXISTS last_run_at,
  DROP COLUMN IF EXISTS last_success_at,
  DROP COLUMN IF EXISTS last_status,
  DROP COLUMN IF EXISTS liveness,
  DROP COLUMN IF EXISTS silent_sec,
  DROP COLUMN IF EXISTS registered_via,
  DROP COLUMN IF EXISTS ledger_status,
  DROP COLUMN IF EXISTS note,
  DROP COLUMN IF EXISTS workflow_id,
  DROP COLUMN IF EXISTS journey_id,
  DROP COLUMN IF EXISTS ops_workflow_id,
  DROP COLUMN IF EXISTS owner_manual,
  DROP COLUMN IF EXISTS note_manual,
  DROP COLUMN IF EXISTS tree_bucket_manual;
DELETE FROM schema_version WHERE version = '517';
COMMIT;
