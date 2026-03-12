-- Migration 152: brain_state 表 + global_quota_cooldown_until 字段
--
-- 背景：quota-cooling.js 原为纯内存实现，Brain 重启后冷却状态丢失。
-- 目标：引入 brain_state singleton 表持久化全局配额冷却截止时间，
--       确保 Brain 重启后仍能正确判断是否处于冷却期。
--
-- 设计：
--   - brain_state 为 singleton 表，仅允许 id='singleton' 一行
--   - global_quota_cooldown_until TIMESTAMPTZ DEFAULT NULL
--     NULL 表示当前无冷却，非 NULL 表示冷却截止时间

-- ============================================================
-- 1. 创建 brain_state singleton 表（若不存在）
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_state (
  id                         VARCHAR(32)  PRIMARY KEY,
  global_quota_cooldown_until TIMESTAMPTZ DEFAULT NULL,
  updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. 确保 singleton 行存在
-- ============================================================
INSERT INTO brain_state (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. 若表已存在但缺少列，补充添加（幂等）
-- ============================================================
ALTER TABLE brain_state
  ADD COLUMN IF NOT EXISTS global_quota_cooldown_until TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE brain_state
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ============================================================
-- 4. 记录 migration 版本
-- ============================================================
INSERT INTO schema_version (version, description, applied_at)
VALUES ('152', 'brain_state singleton 表 + global_quota_cooldown_until 持久化', NOW())
ON CONFLICT (version) DO NOTHING;
