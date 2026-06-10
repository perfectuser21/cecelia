-- Migration 299: okr_initiatives 生命周期状态机（PR 2b-1）
-- 双轴模型执行轴：Initiative 收敛为一条干净生命周期 planned → queued → running → done / failed。
-- 为 2b-2 harness 认领 planned 铺路。语义保持的重命名（不改任何调度逻辑）：
--   pending / planning → planned
--   active / in_progress → running
--   completed → done
--   queued / archived 不变（archived = legacy 终态，保留无损）
-- 参见 docs/superpowers/specs/2026-06-10-phase2b-initiative-unify-prd.md §3 PR 2b-1

-- 1. 数据映射（幂等：旧值已不存在时这些 UPDATE 命中 0 行）
UPDATE okr_initiatives SET status = 'running' WHERE status IN ('active', 'in_progress');
UPDATE okr_initiatives SET status = 'planned' WHERE status IN ('pending', 'planning');
UPDATE okr_initiatives SET status = 'done'    WHERE status = 'completed';

-- 2. CHECK 约束：锁定生命周期词汇，根治 status drift。
--    5 个生命周期值 planned/queued/running/done/failed + 2 个 legacy 终态 archived/cancelled。
ALTER TABLE okr_initiatives DROP CONSTRAINT IF EXISTS okr_initiatives_status_check;
ALTER TABLE okr_initiatives
  ADD CONSTRAINT okr_initiatives_status_check
  CHECK (status IN ('planned', 'queued', 'running', 'done', 'failed', 'archived', 'cancelled'));
