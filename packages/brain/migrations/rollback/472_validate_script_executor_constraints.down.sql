-- 回滚 472：VALIDATE 无法撤销（PostgreSQL 没有 "un-validate"），只删版本行。
-- 约束本身随 471 的 down 一起重建为旧形状。
BEGIN;
DELETE FROM schema_version WHERE version = '472';
COMMIT;
