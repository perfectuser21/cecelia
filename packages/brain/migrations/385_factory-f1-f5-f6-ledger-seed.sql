-- Migration 385: 格子账本模板铺开——工厂域 F1/F5 先行 + F6 假绿修正
--
-- Scope:
--   1. 补 F1（工厂·F1 开发闭环）home='factory'
--   2. 种 F1（4步）格子账本：capability/element/scenario/base_ref
--   3. 种 F5（4步）格子账本
--   4. 种 F6（3步）格子账本；修 S3 假绿：journey_steps.status done→in_progress
--
-- 新格子全部设为 'gray'（未评估）；有 assertion_ref 的绿格在后续专项 migration 补。
-- 幂等：ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO UPDATE。

BEGIN;

-- ① 补 F1 home 字段（F5/F6 已是 factory）
UPDATE journeys
SET home = 'factory', updated_at = NOW()
WHERE id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid
  AND (home IS NULL OR home != 'factory');

-- ② F6 S3 假绿修正：journey_steps.status done → in_progress
UPDATE journey_steps
SET status = 'in_progress', updated_at = NOW()
WHERE id = '42fcffb2-547e-4a71-ba8c-c66969f76df9'::uuid
  AND status = 'done';

-- ③ 格子种子（F1 / F5 / F6）
--    CTE 直接用 step_id UUID，跳过 journey_id+step_number JOIN（避免歧义）
WITH cell_data(step_id, ckind, ckey, cstatus, fid, aref, nar) AS (VALUES

  -- ===== F1 S1 接单进车间即分档（in_progress）=====
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec'::uuid,'capability','任务入档','gray',NULL::uuid,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','capability','档位分配','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','capability','执行体指定','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','capability','黑洞检测','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','FR','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','NFR','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','判定点','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','不变量','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','失败语义','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','死亡告警','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','效果确认','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','对抗面','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','element','保质期','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','scenario','日常','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','scenario','遗漏进场','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','scenario','多任务竞态','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','scenario','降级','gray',NULL,NULL,NULL),
  ('3bf6c116-169c-46ec-bc7c-b335a22f80ec','base_ref','GP锚定校验','gray','97400e37-3558-4db7-990e-98c3f2634cc8',NULL,NULL),

  -- ===== F1 S2 合同即法律（done）=====
  ('406b621a-3e2e-4e8c-a818-682747324c18'::uuid,'capability','剧本合同生成','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','capability','GAN对抗执行','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','capability','验收标准人话化','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','element','FR','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','element','NFR','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','element','判定点','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','element','不变量','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','element','失败语义','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','element','效果确认','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','scenario','日常','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','scenario','无spec无合同','gray',NULL,NULL,NULL),
  ('406b621a-3e2e-4e8c-a818-682747324c18','scenario','对抗失败','gray',NULL,NULL,NULL),

  -- ===== F1 S3 造完真验（in_progress）=====
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b'::uuid,'capability','三层验收','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','capability','真环境对齐','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','capability','CI门禁守门','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','FR','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','NFR','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','判定点','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','不变量','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','失败语义','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','死亡告警','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','element','效果确认','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','scenario','日常','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','scenario','验收失败','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','scenario','绕过尝试','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','scenario','降级','gray',NULL,NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','base_ref','交付人工验收闭环（Notion）','gray','d7b8b3c6-7ba3-4798-a9fa-2902e680a0de',NULL,NULL),
  ('aad25bdb-bdd6-47f4-9a99-e1176e23ac8b','base_ref','GP锚定校验','gray','97400e37-3558-4db7-990e-98c3f2634cc8',NULL,NULL),

  -- ===== F1 S4 交付有回执（done）=====
  ('36121154-5e52-4b20-a2cd-2f415ee72fac'::uuid,'capability','PR合并回写','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','capability','handoff存档','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','capability','账本回写','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','capability','尸检报告','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','element','FR','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','element','NFR','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','element','判定点','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','element','不变量','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','element','失败语义','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','element','账本保鲜','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','scenario','日常','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','scenario','遗漏回写','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','scenario','失败无尸检','gray',NULL,NULL,NULL),
  ('36121154-5e52-4b20-a2cd-2f415ee72fac','base_ref','交付人工验收闭环（Notion）','gray','d7b8b3c6-7ba3-4798-a9fa-2902e680a0de',NULL,NULL),

  -- ===== F5 S1 一眼全景（in_progress）=====
  ('0610b894-67b7-496f-9005-325864a0fcef'::uuid,'capability','总览看板','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','capability','实时数据推送','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','capability','状态着色','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','element','FR','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','element','NFR','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','element','判定点','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','element','不变量','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','element','失败语义','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','element','效果确认','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','scenario','日常','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','scenario','数据滞后','gray',NULL,NULL,NULL),
  ('0610b894-67b7-496f-9005-325864a0fcef','scenario','降级','gray',NULL,NULL,NULL),

  -- ===== F5 S2 下钻证据（done）=====
  ('626817c6-3dc7-4773-97ab-d4892f064e8e'::uuid,'capability','下钻导航','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','capability','证据追溯','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','capability','时间轴视图','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','element','FR','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','element','NFR','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','element','判定点','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','element','不变量','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','element','失败语义','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','scenario','日常','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','scenario','数据断链','gray',NULL,NULL,NULL),
  ('626817c6-3dc7-4773-97ab-d4892f064e8e','scenario','降级','gray',NULL,NULL,NULL),

  -- ===== F5 S3 看到的等于真相（planned）=====
  ('506af462-a237-4f6c-a746-496afdc30f6a'::uuid,'capability','数据一致性校验','gray',NULL,NULL,NULL),
  ('506af462-a237-4f6c-a746-496afdc30f6a','capability','真相锚定','gray',NULL,NULL,NULL),
  ('506af462-a237-4f6c-a746-496afdc30f6a','element','FR','gray',NULL,NULL,NULL),
  ('506af462-a237-4f6c-a746-496afdc30f6a','element','NFR','gray',NULL,NULL,NULL),
  ('506af462-a237-4f6c-a746-496afdc30f6a','element','判定点','gray',NULL,NULL,NULL),
  ('506af462-a237-4f6c-a746-496afdc30f6a','element','不变量','gray',NULL,NULL,NULL),
  ('506af462-a237-4f6c-a746-496afdc30f6a','element','失败语义','gray',NULL,NULL,NULL),
  ('506af462-a237-4f6c-a746-496afdc30f6a','scenario','日常','gray',NULL,NULL,NULL),
  ('506af462-a237-4f6c-a746-496afdc30f6a','scenario','数据偏差','gray',NULL,NULL,NULL),
  ('506af462-a237-4f6c-a746-496afdc30f6a','scenario','降级','gray',NULL,NULL,NULL),

  -- ===== F5 S4 舱内拍板（in_progress）=====
  ('e51f80a3-8559-48ad-bb54-264f6fbde599'::uuid,'capability','决策录入','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','capability','拍板留痕','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','capability','通知下发','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','element','FR','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','element','NFR','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','element','判定点','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','element','不变量','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','element','失败语义','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','element','效果确认','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','element','两轴衔接','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','scenario','日常','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','scenario','无决据','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','scenario','降级','gray',NULL,NULL,NULL),
  ('e51f80a3-8559-48ad-bb54-264f6fbde599','base_ref','主理人对话回路','gray','c36467aa-c59a-4319-af21-b36c16b8d82b',NULL,NULL),

  -- ===== F6 S1 丢进去有回执（done）=====
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1'::uuid,'capability','捕获入库','gray',NULL,NULL,NULL),
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1','capability','回执生成','gray',NULL,NULL,NULL),
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1','capability','幂等检查','gray',NULL,NULL,NULL),
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1','element','FR','gray',NULL,NULL,NULL),
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1','element','NFR','gray',NULL,NULL,NULL),
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1','element','不变量','gray',NULL,NULL,NULL),
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1','element','失败语义','gray',NULL,NULL,NULL),
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1','scenario','日常','gray',NULL,NULL,NULL),
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1','scenario','重复投递','gray',NULL,NULL,NULL),
  ('5cafc898-0c74-40eb-ba32-e22fa884d0f1','scenario','断网','gray',NULL,NULL,NULL),

  -- ===== F6 S2 十分钟内归位（done）=====
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613'::uuid,'capability','自动分拣','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','capability','人工归位','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','capability','超时检测','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','element','FR','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','element','NFR','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','element','判定点','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','element','不变量','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','element','失败语义','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','scenario','日常','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','scenario','超时','gray',NULL,NULL,NULL),
  ('7f3931a4-fcac-46af-bcfc-fed1f80f0613','scenario','分拣失败','gray',NULL,NULL,NULL),

  -- ===== F6 S3 去向可查账龄不烂（假绿修正→in_progress）=====
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9'::uuid,'capability','去向链接','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','capability','账龄看板','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','capability','烂账警报','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','element','FR','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','element','NFR','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','element','判定点','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','element','不变量','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','element','失败语义','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','element','死亡告警','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','scenario','日常','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','scenario','无去向','gray',NULL,NULL,NULL),
  ('42fcffb2-547e-4a71-ba8c-c66969f76df9','scenario','账龄过期','gray',NULL,NULL,NULL)
)
INSERT INTO journey_step_links
  (journey_id, step_id, cell_kind, cell_key, cell_status, feature_id, assertion_ref, na_reason, status, notion_synced_at)
SELECT
  s.journey_id,
  cd.step_id,
  cd.ckind,
  cd.ckey,
  cd.cstatus,
  cd.fid,
  cd.aref,
  cd.nar,
  'planned',
  NOW()
FROM cell_data cd
JOIN journey_steps s ON s.id = cd.step_id
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO UPDATE SET
  cell_status   = EXCLUDED.cell_status,
  feature_id    = EXCLUDED.feature_id,
  assertion_ref = EXCLUDED.assertion_ref,
  na_reason     = EXCLUDED.na_reason;

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '385',
  '格子账本模板铺开：工厂域 F1/F5/F6 种子格子 + F1 home=factory + F6 S3 假绿修正',
  NOW()
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
