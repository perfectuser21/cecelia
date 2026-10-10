-- 回滚 541：按固定 id 删除 coding workflow 流程、引用与 12 个 Activity（span 外键指向 activities，先删本流程的 span）。
BEGIN;
DELETE FROM spans WHERE activity_id::text LIKE 'c0de0000-0000-4000-8000-0000000001%';
DELETE FROM workflow_activity_refs WHERE workflow_id = 'c0de0000-0000-4000-8000-000000000001';
DELETE FROM activities WHERE id::text LIKE 'c0de0000-0000-4000-8000-0000000001%';
DELETE FROM workflows WHERE id = 'c0de0000-0000-4000-8000-000000000001';
COMMIT;
