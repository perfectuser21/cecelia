-- Migration 036: Fix Goal Hierarchy - Insert Global KR Layer
-- 问题：Area OKR 直接挂在 Global OKR 下，跳过了 Global KR 层
-- 方案 B：保留现有数据，插入缺失的 Global KR，修正 parent_id，更新 type

BEGIN;

-- 0) 审计表（记录修复操作）
CREATE TABLE IF NOT EXISTS goal_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_key text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1) 扩展 type 约束，允许 global_kr 和 area_kr
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_type_check;
ALTER TABLE goals ADD CONSTRAINT goals_type_check
  CHECK (type IN ('global_okr', 'global_kr', 'area_okr', 'area_kr', 'kr'));

-- 2) 防误操作：锁表
LOCK TABLE goals IN SHARE ROW EXCLUSIVE MODE;

-- 3) 校验：确保 Global OKR 存在
DO $$
DECLARE
  global_okr_count int;
BEGIN
  SELECT count(*) INTO global_okr_count
  FROM goals
  WHERE type = 'global_okr' AND parent_id IS NULL;

  IF global_okr_count < 1 THEN
    RAISE EXCEPTION 'No global OKR found. Cannot proceed with migration.';
  END IF;

  RAISE NOTICE 'Found % Global OKRs', global_okr_count;
END $$;

-- 4) 手动映射：Area OKR 应该挂到哪个 Global KR
CREATE TEMP TABLE tmp_area_to_global_kr (
  global_okr_id uuid NOT NULL,
  global_kr_title text NOT NULL,
  area_okr_id uuid NOT NULL
);

INSERT INTO tmp_area_to_global_kr (global_okr_id, global_kr_title, area_okr_id) VALUES
  -- Global OKR "Cecelia 24/7" 下的映射
  ('91c26771-f7ef-4c39-b13e-5a65e5d0b177', '接管部门能力', 'b4444444-0000-0000-0000-000000000004'), -- 接管 toutiao
  ('91c26771-f7ef-4c39-b13e-5a65e5d0b177', '接管部门能力', 'b3333333-0000-0000-0000-000000000003'), -- 接管 trading
  ('91c26771-f7ef-4c39-b13e-5a65e5d0b177', '接管部门能力', 'b2222222-0000-0000-0000-000000000002'), -- 接管 zenithjoy
  ('91c26771-f7ef-4c39-b13e-5a65e5d0b177', '接管部门能力', 'b1111111-0000-0000-0000-000000000001'); -- 接管 cecelia-core

-- 5) 创建缺失的 Global KR（去重）
WITH distinct_kr AS (
  SELECT DISTINCT global_okr_id, global_kr_title
  FROM tmp_area_to_global_kr
),
to_create AS (
  SELECT
    dk.global_okr_id,
    dk.global_kr_title
  FROM distinct_kr dk
  LEFT JOIN goals existing
    ON existing.parent_id = dk.global_okr_id
   AND existing.type = 'global_kr'
   AND existing.title = dk.global_kr_title
  WHERE existing.id IS NULL
)
INSERT INTO goals (title, type, parent_id, status, priority, created_at, updated_at)
SELECT
  global_kr_title,
  'global_kr',
  global_okr_id,
  'in_progress',
  'P0',
  now(),
  now()
FROM to_create
RETURNING id, title, parent_id;

-- 6) 修正 Area OKR 的 parent_id → 指向对应 Global KR
WITH gkr AS (
  SELECT id, title, parent_id AS global_okr_id
  FROM goals
  WHERE type = 'global_kr'
),
mapping AS (
  SELECT
    t.area_okr_id,
    gkr.id AS new_parent_id,
    gkr.title AS global_kr_title
  FROM tmp_area_to_global_kr t
  JOIN gkr ON gkr.global_okr_id = t.global_okr_id
          AND gkr.title = t.global_kr_title
)
UPDATE goals g
SET
  parent_id = m.new_parent_id,
  updated_at = now()
FROM mapping m
WHERE g.id = m.area_okr_id
RETURNING g.id, g.title, g.parent_id;

-- 7) 更新 KR type：parent 是 global_okr → global_kr
UPDATE goals g
SET type = 'global_kr', updated_at = now()
WHERE g.type = 'kr'
  AND EXISTS (
    SELECT 1 FROM goals p
    WHERE p.id = g.parent_id
      AND p.type = 'global_okr'
  )
RETURNING id, title, type;

-- 8) 更新 KR type：parent 是 area_okr → area_kr
UPDATE goals g
SET type = 'area_kr', updated_at = now()
WHERE g.type = 'kr'
  AND EXISTS (
    SELECT 1 FROM goals p
    WHERE p.id = g.parent_id
      AND p.type = 'area_okr'
  )
RETURNING id, title, type;

-- 9) 写审计记录
INSERT INTO goal_repairs (repair_key, details)
VALUES (
  'fix_goal_hierarchy_insert_global_kr_and_reparent_area_okrs',
  jsonb_build_object(
    'area_to_global_kr', (SELECT jsonb_agg(to_jsonb(t)) FROM tmp_area_to_global_kr t),
    'timestamp', now(),
    'migration', '036'
  )
);

-- 10) 校验：不允许 area_okr 直接挂 global_okr（跳层）
DO $$
DECLARE
  bad_count int;
  bad_examples text;
BEGIN
  SELECT count(*) INTO bad_count
  FROM goals a
  JOIN goals p ON p.id = a.parent_id
  WHERE a.type = 'area_okr'
    AND p.type = 'global_okr';

  IF bad_count > 0 THEN
    SELECT string_agg(a.title, ', ') INTO bad_examples
    FROM goals a
    JOIN goals p ON p.id = a.parent_id
    WHERE a.type = 'area_okr'
      AND p.type = 'global_okr'
    LIMIT 5;

    RAISE EXCEPTION 'Validation failed: % area_okr still point to global_okr. Examples: %',
      bad_count, bad_examples;
  END IF;

  RAISE NOTICE 'Validation passed: No area_okr points to global_okr';
END $$;

-- 11) 最终统计
DO $$
DECLARE
  global_okr_count int;
  global_kr_count int;
  area_okr_count int;
  area_kr_count int;
  legacy_kr_count int;
BEGIN
  SELECT count(*) INTO global_okr_count FROM goals WHERE type = 'global_okr';
  SELECT count(*) INTO global_kr_count FROM goals WHERE type = 'global_kr';
  SELECT count(*) INTO area_okr_count FROM goals WHERE type = 'area_okr';
  SELECT count(*) INTO area_kr_count FROM goals WHERE type = 'area_kr';
  SELECT count(*) INTO legacy_kr_count FROM goals WHERE type = 'kr';

  RAISE NOTICE 'Migration 036 完成统计:';
  RAISE NOTICE '  Global OKRs: %', global_okr_count;
  RAISE NOTICE '  Global KRs: %', global_kr_count;
  RAISE NOTICE '  Area OKRs: %', area_okr_count;
  RAISE NOTICE '  Area KRs: %', area_kr_count;
  RAISE NOTICE '  Legacy KRs (待处理): %', legacy_kr_count;
END $$;

-- 12) 更新 schema_version
INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '036',
  'Fix goal hierarchy: insert Global KR layer, reparent Area OKRs, split kr type',
  now()
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
