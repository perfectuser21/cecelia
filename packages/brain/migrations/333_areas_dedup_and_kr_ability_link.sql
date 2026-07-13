-- Migration 333: OKR 数据卫生——areas 表去重 + FK 迁移 + 2条active Objective挂area
-- + ZenithJoy线 KR1/KR2 挂 metadata.target_abilities（T6两轴衔接，okr/kr/:id/ability-progress 对账用）
--
-- 审计（2026-07-11 任务 8214262f）：areas 表 19 条记录里 8 组同名重复
-- （notion-sync.js 两次批量写入产生：2026-03-02 20:30 批次 vs 2026-03-03 09:30 批次）；
-- 2 个 active Objective（Cecelia基础稳固/ZenithJoy产品全线上线）area_id 为空；
-- ZenithJoy 线 5 条 KR 的 metadata.target_abilities 未挂，progress_pct 锁死 0.00。
--
-- 去重原则（不盲删）：先查每个重复 id 在 20 张带 area_id 外键表里的真实引用数，
-- 0 引用直接删；两边都有引用（仅 Cecelia 一组）先把少引用一侧迁移到多引用一侧再删。

-- Step 1: Cecelia 重复对——bdf1f5c1（journey_features/knowledge/okr_initiatives/
-- okr_projects/okr_scopes 共 25 处引用）保留；b4582eda（key_results 3 + objectives 4 = 7 处引用）
-- 先迁移引用再删除
UPDATE key_results SET area_id = 'bdf1f5c1-77bd-4c4c-9f6e-e7c1fc46f358'
  WHERE area_id = 'b4582eda-ac11-49bc-9cd9-4e70093273bf';
UPDATE objectives SET area_id = 'bdf1f5c1-77bd-4c4c-9f6e-e7c1fc46f358'
  WHERE area_id = 'b4582eda-ac11-49bc-9cd9-4e70093273bf';

-- Step 2: 删除 0 引用的重复行（AI Systems & Automation / Learning & Growth / Life Management /
-- Meta / Social Media / Stock Investment 各 1 个重复 + 已迁移完引用的 Cecelia 旧行 +
-- ZenithJoy 重复行(0引用) + Hobbies 旧名"Hobbies & Creative"(0引用，保留"Hobbies & Creative Interests")
DELETE FROM areas WHERE id IN (
  '95977fd1-423e-4ada-bd85-a53194e9f5a9', -- AI Systems & Automation dup
  'ce295eea-32a0-4ba2-b86d-ed361721162a', -- Hobbies & Creative（旧名，无引用）
  '81373574-6ffc-4f27-9346-340b3f78dbd5', -- Learning & Growth dup
  '5d94e23b-3d82-4394-9036-b0cb6ce9ff37', -- Life Management dup
  '478e131d-d69a-46c5-aa38-9e6ec11b8639', -- Meta dup
  'b4582eda-ac11-49bc-9cd9-4e70093273bf', -- Cecelia dup（引用已迁移到 bdf1f5c1）
  '47da45f7-9f1b-4e2a-a2b6-f4fe049cc10b', -- Social Media dup
  '3acecef9-dc66-4a5b-9e71-cc590d755e68', -- Stock Investment dup
  '114ebe6f-4b67-4dc9-bb93-e8cee06fb838'  -- ZenithJoy dup（0引用）
);

-- Step 3: 2 个 active Objective 挂上正确的 area_id
UPDATE objectives SET area_id = 'bdf1f5c1-77bd-4c4c-9f6e-e7c1fc46f358'
  WHERE id = '9b491a28-3671-47c1-ad69-a51d3e1d2bb8'; -- Cecelia 基础稳固
UPDATE objectives SET area_id = '390d0f19-9af4-4ee3-b5e7-5912d8256ae9'
  WHERE id = 'e6776bc9-b756-4fce-92d8-0a32aa35d985'; -- ZenithJoy 产品全线上线

-- Step 4: ZenithJoy 线 KR1/KR2 挂 metadata.target_abilities
-- KR3(微信小程序上线)/KR5(Dashboard可交付) 无对应 journey，跳过（登记 issue，不硬凑）
-- KR4(geo SEO网站) 已 completed，跳过
UPDATE key_results SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('target_abilities', ARRAY[
  '1bbf5d4b-35f4-49a2-84f7-f5666163df90', '8677b2d1-8887-4b7c-88ed-eea4e6a8afa9', 'fef041e5-4a8e-4c3d-9dbd-0842bc03325a',
  '74335c04-78b5-438c-983a-32db3ce52881', '116a9fc6-0e93-423e-8a2c-b0e7664c6f12', '01c89148-a084-4de1-8582-b474a38a726a',
  'fdb7c6e3-47da-4903-b990-75090c4a7153', '3acfe778-b20d-4e83-a237-cb96fddb1fdf', '4c736fe3-af2f-4a40-9787-e172a05e0e18',
  '2e65234b-fc45-42b0-b6f2-f0eefd7950d9', '99d14f48-d229-4fed-86db-2530fab01fca', '6a64605a-39dd-4931-a2e4-77640c57a513',
  '01321fec-0491-42a4-b2f1-32a73d674e3a', '87a1b506-f472-4e89-9e43-0ecc6b7f3632', 'e82e5d65-913d-4bb5-a209-f184c3ebfc1b',
  '927f6ea0-f3a2-4b3b-99e0-8f5f07dafada', '9906ba78-12d5-44dd-ab94-8a641323c1b4', 'f8d1f8a2-1fd0-4adf-b006-e6762e4950fb',
  'f02caa3a-6968-484d-8a2e-3deae7951789', 'eb80afc2-c231-4569-ab5c-4fd40a55b7f2', 'd7f8619e-2545-4033-b55c-81ff8ae6b1af'
]::text[])
WHERE id = 'd86f67df-04c8-47dc-922f-c0e4fd0645bb'; -- KR1：AI自媒体线跑通（智能发布 journey 全 21 个 ability）

UPDATE key_results SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('target_abilities', ARRAY[
  '1e4ee48d-365d-4373-a4bc-86a20a917289', 'ca5fe5ec-7cab-418f-a3f6-d64287679e0c', '03dee814-e720-4b59-b5c2-61a6c426d8bd',
  'f2913c7a-3da8-4d03-bb8f-0068c9a9d711', '82a9cd0e-fb32-4498-a6a9-0e74402dc63a', 'ee0b211c-46fc-4bdb-aaa4-cab6c46832e4'
]::text[])
WHERE id = 'f19118cd-c4fe-478d-abf5-00bde5566a05'; -- KR2：AI私域线跑通（客户私域AI接管 journey 8个ability中排除2个deprecated）
