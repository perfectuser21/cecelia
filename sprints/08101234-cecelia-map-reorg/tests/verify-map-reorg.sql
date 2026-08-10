-- ============================================================
-- 验收 SQL：Cecelia 承诺地图归位
-- Sprint: 08101234-cecelia-map-reorg
-- Task ID: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
-- 执行方式: psql $DATABASE_URL -f verify-map-reorg.sql
-- ============================================================

\echo '=== 验收 SQL：Cecelia 承诺地图归位 ==='
\echo ''

-- ------------------------------------------------------------
-- AC-1：2 条 active 价值流
-- ------------------------------------------------------------
\echo '--- AC-1：active 价值流计数（期望: 2）---'
SELECT
  COUNT(*) AS value_stream_count,
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS result
FROM journeys
WHERE parent_journey_id IS NULL
  AND status = 'active'
  AND biz_area = 'cecelia';

-- ------------------------------------------------------------
-- AC-2：工厂线 6 个 Capability
-- ------------------------------------------------------------
\echo '--- AC-2：工厂线 Capability 计数（期望: 6）---'
SELECT
  COUNT(*) AS factory_capability_count,
  CASE WHEN COUNT(*) = 6 THEN 'PASS' ELSE 'FAIL' END AS result
FROM journeys
WHERE parent_journey_id = (
  SELECT id FROM journeys WHERE capability_code = 'VS_FACTORY'
)
AND status = 'active';

-- ------------------------------------------------------------
-- AC-3：管家线 5 个 Capability
-- ------------------------------------------------------------
\echo '--- AC-3：管家线 Capability 计数（期望: 5）---'
SELECT
  COUNT(*) AS steward_capability_count,
  CASE WHEN COUNT(*) = 5 THEN 'PASS' ELSE 'FAIL' END AS result
FROM journeys
WHERE parent_journey_id = (
  SELECT id FROM journeys WHERE capability_code = 'VS_STEWARD'
)
AND status = 'active';

-- ------------------------------------------------------------
-- AC-4：关键锚 journey 行存在（不断裂）
-- ------------------------------------------------------------
\echo '--- AC-4：关键锚 journey 行存在（期望: 2）---'
SELECT
  COUNT(*) AS anchor_journey_count,
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL — anchor 断裂！' END AS result
FROM journeys
WHERE id IN (
  'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29',  -- F1 开发闭环
  '8bb8252f-29b4-4c34-acb9-1accda7ddfcf'   -- F5/G1 指挥舱
);

-- ------------------------------------------------------------
-- AC-4 明细：确认这两行的当前状态
-- ------------------------------------------------------------
\echo '--- AC-4 明细：关键锚 journey 当前状态 ---'
SELECT id, name, capability_code, status, parent_journey_id IS NOT NULL AS has_parent
FROM journeys
WHERE id IN (
  'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29',
  '8bb8252f-29b4-4c34-acb9-1accda7ddfcf'
);

-- ------------------------------------------------------------
-- AC-5：F1 挂片候选列表（人工核查，不是自动断言）
-- ------------------------------------------------------------
\echo '--- AC-5：F1 挂片候选（人工核查，ZenithJoy 相关行应已迁移）---'
SELECT id, name, "group", status,
  CASE
    WHEN name ILIKE '%zenithjoy%' OR name ILIKE '%智能客服%' OR name ILIKE '%客户%'
      OR name ILIKE '%Line04%' OR "group" ILIKE '%zenithjoy%'
    THEN 'CANDIDATE_FOR_ZJ_MIGRATION'
    ELSE 'cecelia'
  END AS migration_flag
FROM journey_features
WHERE journey_id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'
ORDER BY "group", name;

-- ------------------------------------------------------------
-- AC-6：孤儿挂片归零
-- ------------------------------------------------------------
\echo '--- AC-6：孤儿挂片计数（期望: 0）---'
SELECT
  COUNT(*) AS orphan_feature_count,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM journey_features
WHERE journey_id IS NULL
  AND status != 'deprecated';

-- ------------------------------------------------------------
-- AC-7：横切件池 >= 7
-- ------------------------------------------------------------
\echo '--- AC-7：横切件池计数（期望: >= 7）---'
SELECT
  COUNT(*) AS enabler_count,
  CASE WHEN COUNT(*) >= 7 THEN 'PASS' ELSE 'FAIL' END AS result
FROM journey_features
WHERE kind = 'enabler'
  AND status != 'deprecated';

-- ------------------------------------------------------------
-- AC-7 明细：横切件清单
-- ------------------------------------------------------------
\echo '--- AC-7 明细：横切件清单 ---'
SELECT jf.name, jf.kind, jf.status, j.capability_code AS parent_capability
FROM journey_features jf
LEFT JOIN journeys j ON j.id = jf.journey_id
WHERE jf.kind = 'enabler'
  AND jf.status != 'deprecated'
ORDER BY j.capability_code, jf.name;

-- ------------------------------------------------------------
-- 补充：Schema 字段验证（Migration 397）
-- ------------------------------------------------------------
\echo '--- schema：journeys 新字段存在检查 ---'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'journeys'
  AND column_name IN ('parent_journey_id', 'capability_code')
ORDER BY column_name;

\echo '--- schema：capability_code 唯一索引存在检查 ---'
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'journeys'
  AND indexname = 'idx_journeys_capability_code';

-- ------------------------------------------------------------
-- 汇总：全部价值流 + Capability 树形视图
-- ------------------------------------------------------------
\echo '--- 汇总：价值流 + Capability 树形视图 ---'
SELECT
  vs.capability_code AS value_stream,
  vs.name AS vs_name,
  cap.capability_code,
  cap.name AS cap_name,
  cap.status
FROM journeys vs
LEFT JOIN journeys cap ON cap.parent_journey_id = vs.id
WHERE vs.parent_journey_id IS NULL
  AND vs.biz_area = 'cecelia'
  AND vs.status = 'active'
ORDER BY vs.capability_code, cap.capability_code;

\echo '=== 验收 SQL 执行完毕 ==='
