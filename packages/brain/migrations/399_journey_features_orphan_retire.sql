-- Migration 399: journey_features 孤儿挂片归零 + MJ1/[v1] 滞留挂片 retire
-- Sprint: 08101234-cecelia-map-reorg
-- Task: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
-- 2026-08-10
--
-- 变更：
--   1. 将所有 journey_id IS NULL 且 status != 'deprecated' 的 journey_features 行
--      设为 deprecated（孤儿挂片归零，AC-6 期望 = 0）
--   2. 将 MJ1/[v1] 系列名称的滞留挂片同步 retire（名称含 'MJ1' 或 '[v1]' 且非 deprecated）
--
-- 注意：严禁物理 DELETE（I-2 约束）
-- 幂等：UPDATE 已 deprecated 行不变，重复执行安全

-- ── Step 1: 孤儿挂片 retire（journey_id IS NULL）──────────────────────────
UPDATE journey_features
SET status = 'deprecated',
    updated_at = NOW()
WHERE journey_id IS NULL
  AND status != 'deprecated';

-- ── Step 2: MJ1 系列滞留挂片 retire ─────────────────────────────────────
UPDATE journey_features
SET status = 'deprecated',
    updated_at = NOW()
WHERE status != 'deprecated'
  AND (
    name ILIKE '%MJ1%'
    OR name ILIKE '%[v1]%'
    OR "group" ILIKE '%MJ1%'
  );
