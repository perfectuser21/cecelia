-- 回滚 553：删租约表与设备池表（租约只是在途约束，删了回到旧行为：无租约、设备锁按旧判据）。
BEGIN;
DROP TABLE IF EXISTS device_pool_members;
DROP TABLE IF EXISTS device_pools;
DROP TABLE IF EXISTS task_leases;
DELETE FROM schema_version WHERE version = '553';
COMMIT;
