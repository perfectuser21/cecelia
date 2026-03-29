-- Migration 204: 清理 'Test KR for select' 占位符数据
-- 目的：删除 2026-03-24 测试期间写入的 5 条测试 KR 及相关数据
-- 影响表：tasks（2条记录 goal_id 置 NULL）、goal_evaluations（110条级联删除）、key_results（5条删除）

BEGIN;

-- Step 1: 解除 tasks 表对这些测试 KR 的引用（无 FK 约束，但需清空）
UPDATE tasks
SET goal_id = NULL
WHERE goal_id IN (
  '59198eaf-d0a3-4bfe-b821-033c21388c26',
  'aebeb2a2-2720-4d6d-a76e-d37aebab377d',
  '85fe9106-a167-459f-bf21-8652b258e85b',
  '0bf8d944-97a2-4ebe-a708-d261b370c562',
  '81a32d5f-aaaf-4a24-b6a0-8eb6b7d6ec42'
);

-- Step 2: 删除测试 KR（goal_evaluations 通过 ON DELETE CASCADE 自动清理）
DELETE FROM key_results
WHERE title = 'Test KR for select';

COMMIT;
