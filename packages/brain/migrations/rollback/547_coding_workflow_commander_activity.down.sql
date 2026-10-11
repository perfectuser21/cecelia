-- 回滚 547：删除 coding commander Activity 的 span、引用与 Activity 本身。
BEGIN;
DELETE FROM spans WHERE activity_id = 'c0de0000-0000-4000-8000-00000000010d';
DELETE FROM workflow_activity_refs WHERE activity_id = 'c0de0000-0000-4000-8000-00000000010d';
DELETE FROM activities WHERE id = 'c0de0000-0000-4000-8000-00000000010d';
COMMIT;
