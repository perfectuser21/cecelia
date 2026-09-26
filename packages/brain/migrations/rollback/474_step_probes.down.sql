-- 回滚 474：摘掉 step_probes 探针注册表（本迁移新建，无既有数据可保；格子上的 probe: assertion_ref 由调用方自行清理）。
BEGIN;
DROP TABLE IF EXISTS step_probes;
DELETE FROM schema_version WHERE version = '474';
COMMIT;
