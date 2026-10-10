-- 541 回滚。首选回滚是关开关（RELEASE_LINE_SYNC_HOOK=off / RELEASE_LINE_AUTO_ROLLBACK=off / RELEASE_LINE_ENFORCE_RELEASE 保持 off），表和数据留着。
-- 实在要撤 schema：先回退代码（selfcheck 只要求 DB>=expected，旧代码遇到 541 库照样启动），
-- 再执行本文件。会删掉只追加的发布线历史，执行前先导出：
--   pg_dump -t activity_versions -t activity_version_builds -t activity_release_state -t activity_release_events -t workflow_production_recipes
BEGIN;
DROP TABLE IF EXISTS workflow_production_recipes;
DROP TABLE IF EXISTS activity_release_events;
DROP TABLE IF EXISTS activity_release_state;
DROP TABLE IF EXISTS activity_version_builds;
DROP TABLE IF EXISTS activity_versions;
DROP FUNCTION IF EXISTS release_line_append_only();
ALTER TABLE activity_judgments DROP CONSTRAINT IF EXISTS activity_judgments_trigger_kind_check;
ALTER TABLE activity_judgments ADD CONSTRAINT activity_judgments_trigger_kind_check CHECK (trigger_kind IN ('auto', 'manual')) NOT VALID;
DELETE FROM schema_version WHERE version = '541';
COMMIT;
