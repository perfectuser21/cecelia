-- 回滚 467：VALIDATE 无法撤销（PostgreSQL 没有 "un-validate"），只删版本行。
-- 约束本身随 466 的 down 一起删除。
BEGIN;
DELETE FROM schema_version WHERE version = '467';
COMMIT;
