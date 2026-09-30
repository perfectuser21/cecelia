-- Rollback 495：projects 表是本迁移重建的（186 曾 DROP TABLE），回滚即整表再次 DROP
-- （CASCADE 顺带删掉 tasks_project_id_fkey）。okr_projects 表、tasks.project_id 列本身、
-- 历史 task_type=project 根任务与其 payload.migrated_to_project 标记不受影响（数据在别处，不删）。
BEGIN;
DROP TABLE IF EXISTS projects CASCADE;
DELETE FROM schema_version WHERE version = '495';
COMMIT;
