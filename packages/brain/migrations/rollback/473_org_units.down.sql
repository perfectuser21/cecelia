-- 回滚 473：摘掉 org_units / org_unit_members 两张新表（本迁移新建，无既有数据可保）。
BEGIN;
DROP TABLE IF EXISTS org_unit_members;
DROP TABLE IF EXISTS org_units;
DELETE FROM schema_version WHERE version = '473';
COMMIT;
