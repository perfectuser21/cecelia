-- 回滚 489：删 recurring_tasks.skip_streak。
ALTER TABLE recurring_tasks
  DROP COLUMN IF EXISTS skip_streak;

DELETE FROM schema_version WHERE version = '489';
