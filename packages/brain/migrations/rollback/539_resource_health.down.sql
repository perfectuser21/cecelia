-- 539 回滚：删资源健康两表与汇总视图（历史随表删除）
BEGIN;
DROP VIEW IF EXISTS v_warehouse_item_health;
DROP TABLE IF EXISTS resource_health_events;
DROP TABLE IF EXISTS resource_health;
DROP FUNCTION IF EXISTS resource_health_record_change();
DROP FUNCTION IF EXISTS resource_health_touch();
DELETE FROM schema_version WHERE version = '539';
COMMIT;
