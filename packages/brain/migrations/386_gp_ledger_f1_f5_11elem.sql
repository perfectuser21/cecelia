-- Migration 386: GP-B 84格账本模板铺开——工厂域 F1 开发闭环 + F5 指挥舱
-- 补齐缺失的 11要素 element 格子（全部 gray，后续由 evaluator 逐步点绿）
-- 幂等：ON CONFLICT (step_id, cell_kind, cell_key) DO NOTHING
--
-- F1 (e6f803f2) steps:
--   S1 3bf6c116  S2 406b621a  S3 aad25bdb  S4 36121154
-- F5 (8bb8252f) steps:
--   S1 0610b894  S2 626817c6  S3 506af462  S4 e51f80a3

INSERT INTO journey_step_links
  (journey_id, step_id, cell_kind, cell_key, cell_status, notion_synced_at)
VALUES

-- ══════════════════ F1 开发闭环 ══════════════════

-- F1-S1 (接单进车间即分档) — 缺: 两轴衔接, 账本保鲜
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','两轴衔接','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','账本保鲜','gray',NOW()),

-- F1-S2 (合同即法律) — 缺: 两轴衔接, 死亡告警, 对抗面, 保质期, 账本保鲜
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','406b621a-3e2e-4e8c-a818-682747324c18','element','两轴衔接','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','406b621a-3e2e-4e8c-a818-682747324c18','element','死亡告警','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','406b621a-3e2e-4e8c-a818-682747324c18','element','对抗面','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','406b621a-3e2e-4e8c-a818-682747324c18','element','保质期','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','406b621a-3e2e-4e8c-a818-682747324c18','element','账本保鲜','gray',NOW()),

-- F1-S3 (造完真验) — 缺: 两轴衔接, 对抗面, 保质期, 账本保鲜
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','两轴衔接','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','对抗面','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','保质期','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','账本保鲜','gray',NOW()),

-- F1-S4 (交付有回执) — 缺: 两轴衔接, 死亡告警, 效果确认, 对抗面, 保质期
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','36121154-5e52-4b20-a2cd-2f415ee72fac','element','两轴衔接','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','36121154-5e52-4b20-a2cd-2f415ee72fac','element','死亡告警','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','36121154-5e52-4b20-a2cd-2f415ee72fac','element','效果确认','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','36121154-5e52-4b20-a2cd-2f415ee72fac','element','对抗面','gray',NOW()),
('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','36121154-5e52-4b20-a2cd-2f415ee72fac','element','保质期','gray',NOW()),

-- ══════════════════ F5 指挥舱 ══════════════════

-- F5-S1 (一眼全景) — 缺: 两轴衔接, 死亡告警, 对抗面, 保质期, 账本保鲜
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','0610b894-67b7-496f-9005-325864a0fcef','element','两轴衔接','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','0610b894-67b7-496f-9005-325864a0fcef','element','死亡告警','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','0610b894-67b7-496f-9005-325864a0fcef','element','对抗面','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','0610b894-67b7-496f-9005-325864a0fcef','element','保质期','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','0610b894-67b7-496f-9005-325864a0fcef','element','账本保鲜','gray',NOW()),

-- F5-S2 (下钻证据) — 缺: 两轴衔接, 死亡告警, 效果确认, 对抗面, 保质期, 账本保鲜
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','626817c6-3dc7-4773-97ab-d4892f064e8e','element','两轴衔接','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','626817c6-3dc7-4773-97ab-d4892f064e8e','element','死亡告警','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','626817c6-3dc7-4773-97ab-d4892f064e8e','element','效果确认','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','626817c6-3dc7-4773-97ab-d4892f064e8e','element','对抗面','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','626817c6-3dc7-4773-97ab-d4892f064e8e','element','保质期','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','626817c6-3dc7-4773-97ab-d4892f064e8e','element','账本保鲜','gray',NOW()),

-- F5-S3 (看到的等于真相) — 缺: 两轴衔接, 死亡告警, 效果确认, 对抗面, 保质期, 账本保鲜
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','506af462-a237-4f6c-a746-496afdc30f6a','element','两轴衔接','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','506af462-a237-4f6c-a746-496afdc30f6a','element','死亡告警','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','506af462-a237-4f6c-a746-496afdc30f6a','element','效果确认','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','506af462-a237-4f6c-a746-496afdc30f6a','element','对抗面','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','506af462-a237-4f6c-a746-496afdc30f6a','element','保质期','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','506af462-a237-4f6c-a746-496afdc30f6a','element','账本保鲜','gray',NOW()),

-- F5-S4 (舱内拍板) — 缺: 死亡告警, 对抗面, 保质期, 账本保鲜
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','e51f80a3-8559-48ad-bb54-264f6fbde599','element','死亡告警','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','e51f80a3-8559-48ad-bb54-264f6fbde599','element','对抗面','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','e51f80a3-8559-48ad-bb54-264f6fbde599','element','保质期','gray',NOW()),
('8bb8252f-29b4-4c34-acb9-1accda7ddfcf','e51f80a3-8559-48ad-bb54-264f6fbde599','element','账本保鲜','gray',NOW())

ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('386', 'GP-B 84格模板铺开: F1开发闭环+F5指挥舱 补齐全11要素 element 格', NOW())
ON CONFLICT (version) DO NOTHING;
