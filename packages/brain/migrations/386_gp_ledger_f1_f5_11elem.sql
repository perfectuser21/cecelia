-- Migration 386: GP-B 84格账本模板铺开——工厂域 F1 开发闭环 + F5 指挥舱
-- 补齐缺失的 11要素 element 格子（全部 gray，后续由 evaluator 逐步点绿）
-- 幂等：ON CONFLICT (step_id, cell_kind, cell_key) DO NOTHING
-- CI 空库保护：WHERE EXISTS 过滤不存在的父行，不会触发 FK 报错
--
-- F1 (e6f803f2) steps:
--   S1 3bf6c116  S2 406b621a  S3 aad25bdb  S4 36121154
-- F5 (8bb8252f) steps:
--   S1 0610b894  S2 626817c6  S3 506af462  S4 e51f80a3

WITH seed_data (journey_id, step_id, cell_kind, cell_key) AS (
  VALUES

  -- ══════════════════ F1 开发闭环 ══════════════════

  -- F1-S1 (接单进车间即分档) — 缺: 两轴衔接, 账本保鲜
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'3bf6c116-169c-46ec-bc7c-b335a22f80ec'::uuid,'element','两轴衔接'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'3bf6c116-169c-46ec-bc7c-b335a22f80ec'::uuid,'element','账本保鲜'),

  -- F1-S2 (合同即法律) — 缺: 两轴衔接, 死亡告警, 对抗面, 保质期, 账本保鲜
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'406b621a-3e2e-4e8c-a818-682747324c18'::uuid,'element','两轴衔接'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'406b621a-3e2e-4e8c-a818-682747324c18'::uuid,'element','死亡告警'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'406b621a-3e2e-4e8c-a818-682747324c18'::uuid,'element','对抗面'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'406b621a-3e2e-4e8c-a818-682747324c18'::uuid,'element','保质期'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'406b621a-3e2e-4e8c-a818-682747324c18'::uuid,'element','账本保鲜'),

  -- F1-S3 (造完真验) — 缺: 两轴衔接, 对抗面, 保质期, 账本保鲜
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid,'element','两轴衔接'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid,'element','对抗面'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid,'element','保质期'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid,'element','账本保鲜'),

  -- F1-S4 (交付有回执) — 缺: 两轴衔接, 死亡告警, 效果确认, 对抗面, 保质期
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid,'element','两轴衔接'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid,'element','死亡告警'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid,'element','效果确认'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid,'element','对抗面'),
  ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,'36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid,'element','保质期'),

  -- ══════════════════ F5 指挥舱 ══════════════════

  -- F5-S1 (一眼全景) — 缺: 两轴衔接, 死亡告警, 对抗面, 保质期, 账本保鲜
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'0610b894-67b7-496f-9005-325864a0fcef'::uuid,'element','两轴衔接'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'0610b894-67b7-496f-9005-325864a0fcef'::uuid,'element','死亡告警'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'0610b894-67b7-496f-9005-325864a0fcef'::uuid,'element','对抗面'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'0610b894-67b7-496f-9005-325864a0fcef'::uuid,'element','保质期'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'0610b894-67b7-496f-9005-325864a0fcef'::uuid,'element','账本保鲜'),

  -- F5-S2 (下钻证据) — 缺: 两轴衔接, 死亡告警, 效果确认, 对抗面, 保质期, 账本保鲜
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid,'element','两轴衔接'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid,'element','死亡告警'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid,'element','效果确认'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid,'element','对抗面'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid,'element','保质期'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid,'element','账本保鲜'),

  -- F5-S3 (看到的等于真相) — 缺: 两轴衔接, 死亡告警, 效果确认, 对抗面, 保质期, 账本保鲜
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'506af462-a237-4f6c-a746-496afdc30f6a'::uuid,'element','两轴衔接'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'506af462-a237-4f6c-a746-496afdc30f6a'::uuid,'element','死亡告警'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'506af462-a237-4f6c-a746-496afdc30f6a'::uuid,'element','效果确认'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'506af462-a237-4f6c-a746-496afdc30f6a'::uuid,'element','对抗面'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'506af462-a237-4f6c-a746-496afdc30f6a'::uuid,'element','保质期'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'506af462-a237-4f6c-a746-496afdc30f6a'::uuid,'element','账本保鲜'),

  -- F5-S4 (舱内拍板) — 缺: 死亡告警, 对抗面, 保质期, 账本保鲜
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid,'element','死亡告警'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid,'element','对抗面'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid,'element','保质期'),
  ('8bb8252f-29b4-4c34-acb9-1accda7ddfcf'::uuid,'e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid,'element','账本保鲜')
)
INSERT INTO journey_step_links (journey_id, step_id, cell_kind, cell_key, cell_status, notion_synced_at)
SELECT s.journey_id, s.step_id, s.cell_kind, s.cell_key, 'gray', NOW()
FROM seed_data s
WHERE EXISTS (SELECT 1 FROM journeys      WHERE id = s.journey_id)
  AND EXISTS (SELECT 1 FROM journey_steps WHERE id = s.step_id)
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('386', 'GP-B 84格模板铺开: F1开发闭环+F5指挥舱 补齐全11要素 element 格', NOW())
ON CONFLICT (version) DO NOTHING;
