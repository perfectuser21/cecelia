-- Migration 321: skill_evals.task_id 改为独立 UUID，不再 FK 引用 tasks 表
-- 原因：skill_evals 是独立评估系统，不需要污染 tasks 表；
--       原来的 INSERT INTO tasks 用了错误列名 type（应为 task_type）导致所有 upload 失败
ALTER TABLE skill_evals DROP CONSTRAINT IF EXISTS skill_evals_task_id_fkey;
