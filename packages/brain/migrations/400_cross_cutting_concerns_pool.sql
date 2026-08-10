-- Migration 400: 横切件池 7 项以 kind='enabler' 登记到 journey_features
-- Sprint: 08101234-cecelia-map-reorg
-- Task: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
-- 2026-08-10
--
-- 横切件（Cross-cutting Concerns）是跨多条 Capability 共用的系统能力，
-- 不归属于任何单一 Capability，使用 kind='enabler' 标记。
-- 挂载到 VS_FACTORY 顶层（parent journey 工厂价值流），表达"全工厂域共享"语义。
--
-- 7 项横切件：
--   1. Brain Tick 调度引擎（Brain Tick Loop）
--   2. DevGate 门禁系统
--   3. Harness Relay 执行链路
--   4. 凭据管理与安全（1Password 同步）
--   5. CI/CD 流水线（brain-ci / workspace-ci / engine-ci）
--   6. 告警与 Bark 推送
--   7. Memory & Knowledge 语义搜索（知识库检索）
--
-- 幂等：ON CONFLICT (name, journey_id) DO NOTHING（需确认是否有唯一约束）
-- 若无唯一约束则用 WHERE NOT EXISTS 兜底

-- 检查并插入横切件（使用 VS_FACTORY 顶层作为 enabler 归属 journey）
-- enabler 类型的 journey_features 代表全工厂域/全系统共享能力

-- Step 1: 幂等扩展 kind 枚举（原约束只含 ability/feature，需加入 enabler）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journey_features_kind_check'
  ) THEN
    ALTER TABLE journey_features DROP CONSTRAINT journey_features_kind_check;
  END IF;
  ALTER TABLE journey_features ADD CONSTRAINT journey_features_kind_check
    CHECK (kind = ANY (ARRAY['ability'::text, 'feature'::text, 'enabler'::text]));
END $$;

-- Step 2: 插入 7 项横切件（幂等 WHERE NOT EXISTS 兜底）
DO $$
DECLARE
  v_factory_id UUID := 'aaaaaaaa-f0f0-4000-8000-000000000001';
BEGIN

  -- 1. Brain Tick 调度引擎
  IF NOT EXISTS (
    SELECT 1 FROM journey_features
    WHERE name = 'Brain Tick 调度引擎'
      AND kind = 'enabler'
      AND status != 'deprecated'
  ) THEN
    INSERT INTO journey_features (name, kind, status, journey_id, "group")
    VALUES ('Brain Tick 调度引擎', 'enabler', 'live', v_factory_id, 'cross-cutting');
  END IF;

  -- 2. DevGate 门禁系统
  IF NOT EXISTS (
    SELECT 1 FROM journey_features
    WHERE name = 'DevGate 门禁系统'
      AND kind = 'enabler'
      AND status != 'deprecated'
  ) THEN
    INSERT INTO journey_features (name, kind, status, journey_id, "group")
    VALUES ('DevGate 门禁系统', 'enabler', 'live', v_factory_id, 'cross-cutting');
  END IF;

  -- 3. Harness Relay 执行链路
  IF NOT EXISTS (
    SELECT 1 FROM journey_features
    WHERE name = 'Harness Relay 执行链路'
      AND kind = 'enabler'
      AND status != 'deprecated'
  ) THEN
    INSERT INTO journey_features (name, kind, status, journey_id, "group")
    VALUES ('Harness Relay 执行链路', 'enabler', 'live', v_factory_id, 'cross-cutting');
  END IF;

  -- 4. 凭据管理与安全
  IF NOT EXISTS (
    SELECT 1 FROM journey_features
    WHERE name = '凭据管理与安全'
      AND kind = 'enabler'
      AND status != 'deprecated'
  ) THEN
    INSERT INTO journey_features (name, kind, status, journey_id, "group")
    VALUES ('凭据管理与安全', 'enabler', 'live', v_factory_id, 'cross-cutting');
  END IF;

  -- 5. CI/CD 流水线
  IF NOT EXISTS (
    SELECT 1 FROM journey_features
    WHERE name = 'CI/CD 流水线'
      AND kind = 'enabler'
      AND status != 'deprecated'
  ) THEN
    INSERT INTO journey_features (name, kind, status, journey_id, "group")
    VALUES ('CI/CD 流水线', 'enabler', 'live', v_factory_id, 'cross-cutting');
  END IF;

  -- 6. 告警与 Bark 推送
  IF NOT EXISTS (
    SELECT 1 FROM journey_features
    WHERE name = '告警与 Bark 推送'
      AND kind = 'enabler'
      AND status != 'deprecated'
  ) THEN
    INSERT INTO journey_features (name, kind, status, journey_id, "group")
    VALUES ('告警与 Bark 推送', 'enabler', 'live', v_factory_id, 'cross-cutting');
  END IF;

  -- 7. Memory 语义搜索
  IF NOT EXISTS (
    SELECT 1 FROM journey_features
    WHERE name = 'Memory 语义搜索'
      AND kind = 'enabler'
      AND status != 'deprecated'
  ) THEN
    INSERT INTO journey_features (name, kind, status, journey_id, "group")
    VALUES ('Memory 语义搜索', 'enabler', 'live', v_factory_id, 'cross-cutting');
  END IF;

END $$;
