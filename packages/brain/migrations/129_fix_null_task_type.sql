-- Migration 128: 修复历史脏数据 task_type=NULL → 'dev'
-- 背景：历史 T1/T2 任务创建时未指定 task_type，导致 executor.js/task-router.js 无法正确派发
UPDATE tasks SET task_type = 'dev' WHERE task_type IS NULL;
