-- Migration 386: F1/F5 工厂域格子账本模板补全（84格）
--
-- 目的：
--   将标准格子账本模板（element/scenario/base_ref 标准格子）
--   补入 F1 开发闭环 / F5 指挥舱所有步骤，
--   使两条 journey 达到每步均含标准格子集合（接近84格）。
--
-- 策略：
--   - SELECT ... WHERE EXISTS(journey) AND EXISTS(step) — CI 新 DB 不含这些 UUID，安全跳过
--   - ON CONFLICT (step_id, cell_kind, cell_key) DO NOTHING — 幂等，不覆盖已有格子
--
-- Journey IDs:
--   F1: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
--   F5: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
--
-- Step IDs:
--   F1 S1: 3bf6c116-169c-46ec-bc7c-b335a22f80ec  接单进车间即分档
--   F1 S2: 406b621a-3e2e-4e8c-a818-682747324c18  合同即法律
--   F1 S3: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b  造完真验
--   F1 S4: 36121154-5e52-4b20-a2cd-2f415ee72fac  交付有回执
--   F5 S1: 0610b894-67b7-496f-9005-325864a0fcef  一眼全景
--   F5 S2: 626817c6-3dc7-4773-97ab-d4892f064e8e  下钻证据
--   F5 S3: 506af462-a237-4f6c-a746-496afdc30f6a  看到的等于真相
--   F5 S4: e51f80a3-8559-48ad-bb54-264f6fbde599  舱内拍板

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- F1 步骤1: 接单进车间即分档（3bf6c116）
-- 现有18格, 补3格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
SELECT vals.journey_id, vals.step_id, vals.cell_kind, vals.cell_key, vals.cell_status, vals.status, NOW()
FROM (VALUES
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '3bf6c116-169c-46ec-bc7c-b335a22f80ec'::uuid, 'element',  '保质期',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '3bf6c116-169c-46ec-bc7c-b335a22f80ec'::uuid, 'element',  '对抗面',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '3bf6c116-169c-46ec-bc7c-b335a22f80ec'::uuid, 'scenario', '无 agent', 'gray', 'planned')
) AS vals(journey_id, step_id, cell_kind, cell_key, cell_status, status)
WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = vals.journey_id)
  AND EXISTS (SELECT 1 FROM journey_steps s WHERE s.id = vals.step_id)
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F1 步骤2: 合同即法律（406b621a）
-- 现有12格, 补9格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
SELECT vals.journey_id, vals.step_id, vals.cell_kind, vals.cell_key, vals.cell_status, vals.status, NOW()
FROM (VALUES
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '406b621a-3e2e-4e8c-a818-682747324c18'::uuid, 'element',  '死亡告警',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '406b621a-3e2e-4e8c-a818-682747324c18'::uuid, 'element',  '对抗面',     'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '406b621a-3e2e-4e8c-a818-682747324c18'::uuid, 'element',  '保质期',     'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '406b621a-3e2e-4e8c-a818-682747324c18'::uuid, 'element',  '效果确认',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '406b621a-3e2e-4e8c-a818-682747324c18'::uuid, 'scenario', '多任务竞态', 'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '406b621a-3e2e-4e8c-a818-682747324c18'::uuid, 'scenario', '遗漏进场',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '406b621a-3e2e-4e8c-a818-682747324c18'::uuid, 'scenario', '降级',       'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '406b621a-3e2e-4e8c-a818-682747324c18'::uuid, 'scenario', '合同缺失',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '406b621a-3e2e-4e8c-a818-682747324c18'::uuid, 'base_ref', 'GP锚定校验', 'gray', 'planned')
) AS vals(journey_id, step_id, cell_kind, cell_key, cell_status, status)
WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = vals.journey_id)
  AND EXISTS (SELECT 1 FROM journey_steps s WHERE s.id = vals.step_id)
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F1 步骤3: 造完真验（aad25bdb）
-- 现有16格, 补5格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
SELECT vals.journey_id, vals.step_id, vals.cell_kind, vals.cell_key, vals.cell_status, vals.status, NOW()
FROM (VALUES
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid, 'element',    '对抗面',     'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid, 'element',    '保质期',     'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid, 'capability', '验收回调',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid, 'scenario',   '多任务竞态', 'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid, 'scenario',   '遗漏进场',   'gray', 'planned')
) AS vals(journey_id, step_id, cell_kind, cell_key, cell_status, status)
WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = vals.journey_id)
  AND EXISTS (SELECT 1 FROM journey_steps s WHERE s.id = vals.step_id)
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F1 步骤4: 交付有回执（36121154）
-- 现有14格, 补7格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
SELECT vals.journey_id, vals.step_id, vals.cell_kind, vals.cell_key, vals.cell_status, vals.status, NOW()
FROM (VALUES
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid, 'element',  '死亡告警',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid, 'element',  '效果确认',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid, 'element',  '对抗面',     'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid, 'element',  '保质期',     'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid, 'scenario', '多任务竞态', 'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid, 'scenario', '遗漏回写',   'gray', 'planned'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid, '36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid, 'scenario', '降级',       'gray', 'planned')
) AS vals(journey_id, step_id, cell_kind, cell_key, cell_status, status)
WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = vals.journey_id)
  AND EXISTS (SELECT 1 FROM journey_steps s WHERE s.id = vals.step_id)
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F5 步骤1: 一眼全景（0610b894）
-- 现有12格, 补9格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
SELECT vals.journey_id, vals.step_id, vals.cell_kind, vals.cell_key, vals.cell_status, vals.status, NOW()
FROM (VALUES
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '0610b894-67b7-496f-9005-325864a0fcef'::uuid, 'element',    '死亡告警',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '0610b894-67b7-496f-9005-325864a0fcef'::uuid, 'element',    '对抗面',     'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '0610b894-67b7-496f-9005-325864a0fcef'::uuid, 'element',    '保质期',     'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '0610b894-67b7-496f-9005-325864a0fcef'::uuid, 'scenario',   '多任务竞态', 'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '0610b894-67b7-496f-9005-325864a0fcef'::uuid, 'scenario',   '遗漏进场',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '0610b894-67b7-496f-9005-325864a0fcef'::uuid, 'capability', '巡检守卫',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '0610b894-67b7-496f-9005-325864a0fcef'::uuid, 'base_ref',   'GP锚定校验', 'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '0610b894-67b7-496f-9005-325864a0fcef'::uuid, 'element',    '失败定义',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '0610b894-67b7-496f-9005-325864a0fcef'::uuid, 'element',    '全景偏差',   'gray', 'planned')
) AS vals(journey_id, step_id, cell_kind, cell_key, cell_status, status)
WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = vals.journey_id)
  AND EXISTS (SELECT 1 FROM journey_steps s WHERE s.id = vals.step_id)
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F5 步骤2: 下钻证据（626817c6）
-- 现有11格, 补10格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
SELECT vals.journey_id, vals.step_id, vals.cell_kind, vals.cell_key, vals.cell_status, vals.status, NOW()
FROM (VALUES
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'element',    '死亡告警',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'element',    '对抗面',     'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'element',    '保质期',     'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'element',    '效果确认',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'element',    '多路径对齐', 'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'scenario',   '多任务竞态', 'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'scenario',   '遗漏进场',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'capability', '实时查询',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'base_ref',   'GP锚定校验', 'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid, 'element',    '失败定义',   'gray', 'planned')
) AS vals(journey_id, step_id, cell_kind, cell_key, cell_status, status)
WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = vals.journey_id)
  AND EXISTS (SELECT 1 FROM journey_steps s WHERE s.id = vals.step_id)
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F5 步骤3: 看到的等于真相（506af462）
-- 现有10格, 补11格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
SELECT vals.journey_id, vals.step_id, vals.cell_kind, vals.cell_key, vals.cell_status, vals.status, NOW()
FROM (VALUES
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'element',    '死亡告警',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'element',    '对抗面',     'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'element',    '保质期',     'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'element',    '效果确认',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'element',    '失败定义',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'element',    '多路径对齐', 'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'scenario',   '多任务竞态', 'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'scenario',   '遗漏进场',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'capability', '巡检全图',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'capability', '前后端对账', 'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, '506af462-a237-4f6c-a746-496afdc30f6a'::uuid, 'base_ref',   'GP锚定校验', 'gray', 'planned')
) AS vals(journey_id, step_id, cell_kind, cell_key, cell_status, status)
WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = vals.journey_id)
  AND EXISTS (SELECT 1 FROM journey_steps s WHERE s.id = vals.step_id)
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F5 步骤4: 舱内拍板（e51f80a3）
-- 现有14格, 补7格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
SELECT vals.journey_id, vals.step_id, vals.cell_kind, vals.cell_key, vals.cell_status, vals.status, NOW()
FROM (VALUES
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, 'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid, 'element',  '死亡告警',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, 'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid, 'element',  '对抗面',     'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, 'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid, 'element',  '保质期',     'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, 'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid, 'element',  '失败定义',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, 'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid, 'scenario', '多任务竞态', 'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, 'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid, 'scenario', '遗漏进场',   'gray', 'planned'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid, 'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid, 'base_ref', 'GP锚定校验', 'gray', 'planned')
) AS vals(journey_id, step_id, cell_kind, cell_key, cell_status, status)
WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = vals.journey_id)
  AND EXISTS (SELECT 1 FROM journey_steps s WHERE s.id = vals.step_id)
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('386', 'F1/F5 工厂域格子账本模板补全 — 条件插入，CI 空库安全跳过', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
