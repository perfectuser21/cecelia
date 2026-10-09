-- 回滚 469：摘掉 owner_decision 协议触发器与函数（之后 psql 直写 owner_decision 不再被拦，应用层校验仍在）。
BEGIN;
DROP TRIGGER IF EXISTS trg_tasks_owner_decision_protocol ON tasks;
DROP FUNCTION IF EXISTS tasks_owner_decision_protocol_guard();
DELETE FROM schema_version WHERE version = '469';
COMMIT;
