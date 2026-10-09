-- 回滚 470：摘掉绑定列（执行侧读取失败即回落硬编码 skillMap，零影响）。
-- 迁移 470 回填时新建的 skill_registry 行（如有）不删，由人工按需清理。
BEGIN;
DROP INDEX IF EXISTS idx_skill_registry_task_types;
ALTER TABLE skill_registry DROP COLUMN IF EXISTS task_types;
ALTER TABLE skill_registry DROP COLUMN IF EXISTS dispatch_command;
DELETE FROM schema_version WHERE version = '470';
COMMIT;
