-- Migration 302: decisions 分层列 level / target_type / target_id / scope
-- 背景：Decision System 地基 sprint 依赖这些列（合同引用「migration 302，线上已应用」），
--   但该 migration 此前只手动应用到线上库、未提交进 repo —— 导致任何从 repo migrations
--   重建的库（CI dod-behavior-dynamic 的 cecelia_test、新环境）缺列。此处补齐，与线上 schema
--   完全一致；全部 IF NOT EXISTS / 存在性守卫，对已有这些列的线上库幂等安全。
-- Evaluator 运行 E2E 前执行: psql $DB < packages/brain/migrations/302_decisions_level_target_scope.sql

-- 分层列（局部决策 area/ability/feature/step + 多态 target 指向 journey_features）
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS level       VARCHAR;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS target_type VARCHAR;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS target_id   UUID;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS scope       VARCHAR;

-- CHECK 约束（与线上一致；用存在性守卫保证幂等）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decisions_level_chk') THEN
    ALTER TABLE decisions ADD CONSTRAINT decisions_level_chk
      CHECK (level IS NULL OR level IN ('area', 'ability', 'feature', 'step'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decisions_target_type_chk') THEN
    ALTER TABLE decisions ADD CONSTRAINT decisions_target_type_chk
      CHECK (target_type IS NULL OR target_type IN ('journey_feature', 'golden_path', 'area'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decisions_scope_chk') THEN
    ALTER TABLE decisions ADD CONSTRAINT decisions_scope_chk
      CHECK (scope IS NULL OR scope IN ('v1', 'backlog'));
  END IF;
END $$;

-- 查询索引（与线上一致）
CREATE INDEX IF NOT EXISTS idx_decisions_target
  ON decisions (target_type, target_id) WHERE target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_decisions_level
  ON decisions (level) WHERE level IS NOT NULL;
