-- Migration 302: decisions 表加 level + 多态 target
-- 让全局战略决策 与 局部决策 统一存一张表，靠 level 区分、target 指向所属对象。
--   level=area    → 全局，不连具体对象（如"统一用 DeepSeek"）
--   level=ability → 连 journey_features(kind=ability)（如"微信发送 频控 ≤2/分"）
--   level=feature → 连 journey_features(kind=feature)（如"cookie 保活间隔"）
--   level=step    → 连 golden_path 某一步/某红队分支（如"第4步发送→后台"）
-- NFR 不是单独的表，是 category 的一种，主要出现在 level=ability/step。
-- scope=v1/backlog 单独一列（不复用 priority：priority 已被 CHECK 锁死为 P0-P3，且语义不同——
--   priority=紧急度，scope=这轮做还是以后做，是两个轴）；round/生成者/验证层放 context jsonb。
-- 不删任何历史行：现有 ~95k 系统行 level/target 为 NULL，查局部决策用 WHERE target_id IS NOT NULL 过滤即可。
-- 执行: psql $DB < packages/brain/migrations/302_decisions_level_target.sql

ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS level       VARCHAR(16),
  ADD COLUMN IF NOT EXISTS target_type VARCHAR(24),
  ADD COLUMN IF NOT EXISTS target_id   UUID,
  ADD COLUMN IF NOT EXISTS scope       VARCHAR(16);

-- scope 取值约束（局部决策用：v1=这轮 / backlog=以后；允许 NULL 兼容历史 + 全局行）
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_scope_chk;
ALTER TABLE decisions ADD CONSTRAINT decisions_scope_chk
  CHECK (scope IS NULL OR scope IN ('v1','backlog'));

-- level 取值约束（允许 NULL 以兼容历史行）
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_level_chk;
ALTER TABLE decisions ADD CONSTRAINT decisions_level_chk
  CHECK (level IS NULL OR level IN ('area','ability','feature','step'));

-- target_type 取值约束（journey_feature 同时覆盖 ability 与 feature，靠 journey_features.kind 区分）
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_target_type_chk;
ALTER TABLE decisions ADD CONSTRAINT decisions_target_type_chk
  CHECK (target_type IS NULL OR target_type IN ('journey_feature','golden_path','area'));

-- 查"某 ability/feature/step 的决策"（只索引局部决策，避开 95k 全局 NULL 行）
CREATE INDEX IF NOT EXISTS idx_decisions_target
  ON decisions (target_type, target_id) WHERE target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_decisions_level
  ON decisions (level) WHERE level IS NOT NULL;
