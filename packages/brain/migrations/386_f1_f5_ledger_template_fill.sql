-- Migration 386: F1/F5 工厂域格子账本模板补全（84格）
--
-- 目的：
--   将标准格子账本模板（element/scenario/base_ref 标准格子）
--   补入 F1 开发闭环 / F5 指挥舱所有步骤，
--   使两条 journey 达到每步均含标准格子集合（接近84格）。
--
-- 策略：ON CONFLICT (step_id, cell_kind, cell_key) DO NOTHING — 不覆盖已有格子
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
VALUES
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '3bf6c116-169c-46ec-bc7c-b335a22f80ec', 'element',  '保质期',    'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '3bf6c116-169c-46ec-bc7c-b335a22f80ec', 'element',  '对抗面',    'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '3bf6c116-169c-46ec-bc7c-b335a22f80ec', 'scenario', '无 agent', 'gray', 'planned', NOW())
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F1 步骤2: 合同即法律（406b621a）
-- 现有12格, 补9格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
VALUES
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '406b621a-3e2e-4e8c-a818-682747324c18', 'element',  '死亡告警',   'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '406b621a-3e2e-4e8c-a818-682747324c18', 'element',  '对抗面',     'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '406b621a-3e2e-4e8c-a818-682747324c18', 'element',  '保质期',     'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '406b621a-3e2e-4e8c-a818-682747324c18', 'element',  '效果确认',   'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '406b621a-3e2e-4e8c-a818-682747324c18', 'scenario', '多任务竞态', 'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '406b621a-3e2e-4e8c-a818-682747324c18', 'scenario', '遗漏进场',   'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '406b621a-3e2e-4e8c-a818-682747324c18', 'scenario', '降级',       'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '406b621a-3e2e-4e8c-a818-682747324c18', 'scenario', '合同缺失',   'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '406b621a-3e2e-4e8c-a818-682747324c18', 'base_ref', 'GP锚定校验', 'gray', 'planned', NOW())
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F1 步骤3: 造完真验（aad25bdb）
-- 现有16格, 补5格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
VALUES
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b', 'element',  '对抗面',     'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b', 'element',  '保质期',     'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b', 'capability','验收回调',  'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b', 'scenario', '多任务竞态', 'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b', 'scenario', '遗漏进场',   'gray', 'planned', NOW())
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F1 步骤4: 交付有回执（36121154）
-- 现有14格, 补7格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
VALUES
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '36121154-5e52-4b20-a2cd-2f415ee72fac', 'element',  '死亡告警',   'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '36121154-5e52-4b20-a2cd-2f415ee72fac', 'element',  '效果确认',   'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '36121154-5e52-4b20-a2cd-2f415ee72fac', 'element',  '对抗面',     'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '36121154-5e52-4b20-a2cd-2f415ee72fac', 'element',  '保质期',     'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '36121154-5e52-4b20-a2cd-2f415ee72fac', 'scenario', '多任务竞态', 'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '36121154-5e52-4b20-a2cd-2f415ee72fac', 'scenario', '遗漏回写',   'gray', 'planned', NOW()),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '36121154-5e52-4b20-a2cd-2f415ee72fac', 'scenario', '降级',       'gray', 'planned', NOW())
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F5 步骤1: 一眼全景（0610b894）
-- 现有12格, 补9格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
VALUES
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '0610b894-67b7-496f-9005-325864a0fcef', 'element',  '死亡告警',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '0610b894-67b7-496f-9005-325864a0fcef', 'element',  '对抗面',     'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '0610b894-67b7-496f-9005-325864a0fcef', 'element',  '保质期',     'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '0610b894-67b7-496f-9005-325864a0fcef', 'scenario', '多任务竞态', 'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '0610b894-67b7-496f-9005-325864a0fcef', 'scenario', '遗漏进场',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '0610b894-67b7-496f-9005-325864a0fcef', 'capability','巡检守卫',  'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '0610b894-67b7-496f-9005-325864a0fcef', 'base_ref', 'GP锚定校验', 'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '0610b894-67b7-496f-9005-325864a0fcef', 'element',  '失败定义',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '0610b894-67b7-496f-9005-325864a0fcef', 'element',  '全景偏差',   'gray', 'planned', NOW())
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F5 步骤2: 下钻证据（626817c6）
-- 现有11格, 补10格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
VALUES
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'element',  '死亡告警',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'element',  '对抗面',     'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'element',  '保质期',     'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'element',  '效果确认',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'element',  '多路径对齐', 'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'scenario', '多任务竞态', 'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'scenario', '遗漏进场',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'capability','实时查询',  'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'base_ref', 'GP锚定校验', 'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '626817c6-3dc7-4773-97ab-d4892f064e8e', 'element',  '失败定义',   'gray', 'planned', NOW())
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F5 步骤3: 看到的等于真相（506af462）
-- 现有10格, 补11格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
VALUES
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'element',  '死亡告警',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'element',  '对抗面',     'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'element',  '保质期',     'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'element',  '效果确认',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'element',  '失败定义',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'element',  '多路径对齐', 'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'scenario', '多任务竞态', 'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'scenario', '遗漏进场',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'capability','巡检全图',  'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'capability','前后端对账', 'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '506af462-a237-4f6c-a746-496afdc30f6a', 'base_ref', 'GP锚定校验', 'gray', 'planned', NOW())
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- F5 步骤4: 舱内拍板（e51f80a3）
-- 现有14格, 补7格 → 21格
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, status, notion_synced_at)
VALUES
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', 'e51f80a3-8559-48ad-bb54-264f6fbde599', 'element',  '死亡告警',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', 'e51f80a3-8559-48ad-bb54-264f6fbde599', 'element',  '对抗面',     'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', 'e51f80a3-8559-48ad-bb54-264f6fbde599', 'element',  '保质期',     'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', 'e51f80a3-8559-48ad-bb54-264f6fbde599', 'element',  '失败定义',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', 'e51f80a3-8559-48ad-bb54-264f6fbde599', 'scenario', '多任务竞态', 'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', 'e51f80a3-8559-48ad-bb54-264f6fbde599', 'scenario', '遗漏进场',   'gray', 'planned', NOW()),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', 'e51f80a3-8559-48ad-bb54-264f6fbde599', 'base_ref', 'GP锚定校验', 'gray', 'planned', NOW())
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('386', 'F1/F5 工厂域格子账本模板补全 — 24+37 格补入使两 journey 达 84 格', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
