-- 回滚 548：技能工厂台账
BEGIN;
DROP TABLE IF EXISTS factory_stage_events;
DROP FUNCTION IF EXISTS factory_stage_events_append_only();
DROP TABLE IF EXISTS factory_ledger;
DELETE FROM schema_version WHERE version = '548';
COMMIT;
