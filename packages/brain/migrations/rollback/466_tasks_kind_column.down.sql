-- 回滚 466：删约束、删列、删版本行。回填的值随列一起丢，重放 466 会按注册表重新回填。
-- 若 467 已应用，先跑 467 的 down（只删版本行），再跑本文件。
BEGIN;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
ALTER TABLE tasks DROP COLUMN IF EXISTS kind;
DELETE FROM schema_version WHERE version = '466';
COMMIT;
