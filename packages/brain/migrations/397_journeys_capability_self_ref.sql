-- Migration 397: journeys 自引用字段 parent_journey_id + capability_code
-- Sprint: 08101234-cecelia-map-reorg
-- Task: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
-- 2026-08-10
--
-- 变更：
--   1. ADD COLUMN parent_journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL
--      — 价值流自引用：顶层行(parent IS NULL)=价值流，子行=Capability
--   2. ADD COLUMN capability_code TEXT
--      — 能力轴短码（VS_FACTORY / VS_STEWARD / F0..F4 / G1..G5 / MJ5 等）
--   3. 唯一索引：每个 capability_code 全局唯一（NULL 行不受约束）
--
-- 幂等：IF NOT EXISTS / IF NOT EXISTS（重复执行安全）

ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS parent_journey_id UUID
    REFERENCES journeys(id) ON DELETE SET NULL;

COMMENT ON COLUMN journeys.parent_journey_id IS
  '价值流自引用：NULL = 顶层价值流行；非 NULL = 属于某价值流的 Capability';

ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS capability_code TEXT;

COMMENT ON COLUMN journeys.capability_code IS
  '能力轴短码（全局唯一）：价值流用 VS_FACTORY/VS_STEWARD；Capability 用 F0..F4/G1..G5/MJ5 等';

-- 唯一索引（跳过 NULL 行，PostgreSQL 部分唯一索引语义）
CREATE UNIQUE INDEX IF NOT EXISTS idx_journeys_capability_code
  ON journeys (capability_code)
  WHERE capability_code IS NOT NULL;
