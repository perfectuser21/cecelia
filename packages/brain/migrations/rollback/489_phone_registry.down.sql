-- 回滚 489：摘掉 phone_registry 手机台账（本迁移新建）。路由在表不存在时自动回退 device_locks 旧口径。
BEGIN;
DROP TABLE IF EXISTS phone_registry;
DELETE FROM schema_version WHERE version = '489';
COMMIT;
