-- Migration 040: Fix initiative kr_id references + establish project_kr_links
-- Problem: All 5 initiatives had kr_id pointing to area_okr (15e28187...)
--          instead of their correct KR. This bypasses KR-level capacity limits
--          and causes planner to misroute tasks.
-- Also: project_kr_links table was empty, breaking KR→Project routing.

-- KR IDs:
--   KR1 = affafff2-007a-453e-aa25-26cd8d17e636 (自动派发跑通)
--   KR2 = 41ec41b0-bb3b-4fbe-998d-18fa1204ce76 (Memory × Capability)
--   KR3 = 6238d18a-bae2-4e2a-9bd1-472551070f63 (自我学习闭环)
-- cecelia-core project = 574b9788-8987-4551-91e6-8c0b1aab63df

-- Fix KR1 initiatives
UPDATE projects
SET kr_id = 'affafff2-007a-453e-aa25-26cd8d17e636'
WHERE id IN (
  '6dddbf3a-1d25-4fab-bdd5-f3511bbba639',  -- KR1-I1: Tick 自动启动稳定性诊断
  'cb1f9f7e-de46-451b-bbfb-c9b01350ba5e'   -- KR1-I2: 任务派发成功率监控与熔断优化
)
AND kr_id = '15e28187-e12e-487b-9f72-ba595acf0767';

-- Fix KR2 initiatives
UPDATE projects
SET kr_id = '41ec41b0-bb3b-4fbe-998d-18fa1204ce76'
WHERE id IN (
  'c48ec543-89b3-4ad8-ad9e-b6471fc96a82'   -- KR2-I1: 决策前记忆检索集成
)
AND kr_id = '15e28187-e12e-487b-9f72-ba595acf0767';

-- Fix KR3 initiatives
UPDATE projects
SET kr_id = '6238d18a-bae2-4e2a-9bd1-472551070f63'
WHERE id IN (
  '5d276996-35f9-4000-bc4d-a74a0d08a3e8',  -- KR3-I1: 任务完成失败后自动 RCA 触发
  'c8e2318c-8a33-4bc0-95ce-5461b8dde169'   -- KR3-I2: Learning 到 Strategy 自动更新
)
AND kr_id = '15e28187-e12e-487b-9f72-ba595acf0767';

-- Establish project_kr_links: cecelia-core → KR1/KR2/KR3
-- This allows planner to route through KR→Project→Initiative→Task path
INSERT INTO project_kr_links (project_id, kr_id, created_at)
VALUES
  ('574b9788-8987-4551-91e6-8c0b1aab63df', 'affafff2-007a-453e-aa25-26cd8d17e636', NOW()),
  ('574b9788-8987-4551-91e6-8c0b1aab63df', '41ec41b0-bb3b-4fbe-998d-18fa1204ce76', NOW()),
  ('574b9788-8987-4551-91e6-8c0b1aab63df', '6238d18a-bae2-4e2a-9bd1-472551070f63', NOW())
ON CONFLICT DO NOTHING;

-- Record migration
INSERT INTO schema_version (version, description, applied_at)
VALUES ('040', 'Fix initiative kr_id references + establish project_kr_links for cecelia-core', NOW())
ON CONFLICT (version) DO NOTHING;
