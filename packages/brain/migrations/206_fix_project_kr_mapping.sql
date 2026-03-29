-- Migration 206: 修复 17 个 planning 项目的 kr_id=null 问题
-- 根因：2026-03-21 批量创建的项目均未关联 KR，导致 6/7 KR 进度无法通过项目推算
-- KR-Project 依赖图（by SelfDrive 诊断 2026-03-29）

-- KR a7527918：系统稳定 — 连续24h不崩溃，自愈成功率≥90%，MTTR<30min
UPDATE okr_projects SET kr_id = 'a7527918-1ab8-45f0-976a-c1384870727f'
WHERE id = 'cbc1038e-f946-4456-8467-fe290ba4e397' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = 'a7527918-1ab8-45f0-976a-c1384870727f'
WHERE id = '501ca7b9-5186-45c2-993f-c109c9a3df97' AND kr_id IS NULL;

-- KR 7ad8006a：管家闭环 — 每天日报+部门经理会议≥1次
UPDATE okr_projects SET kr_id = '7ad8006a-8b74-44fb-a288-52fdcdaed1d1'
WHERE id = 'e1c703b9-87a8-4bb3-b63e-60ff5f6fadaa' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = '7ad8006a-8b74-44fb-a288-52fdcdaed1d1'
WHERE id = '2a273a2d-7b72-4ac7-abb7-f57b83071d57' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = '7ad8006a-8b74-44fb-a288-52fdcdaed1d1'
WHERE id = '5e55c45c-e9e5-4817-a85c-addfe65d5936' AND kr_id IS NULL;

-- KR 90a2ae5e：算力全开 — 3台Mac Mini slot利用率≥70%，Codex自动扫描进化
UPDATE okr_projects SET kr_id = '90a2ae5e-26e0-4ea5-a1a4-9c881c58e6ec'
WHERE id = '7422bc5e-84f2-4f33-8b42-2f905d9af857' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = '90a2ae5e-26e0-4ea5-a1a4-9c881c58e6ec'
WHERE id = 'cf5a9d53-47d7-4689-ab67-7c9c9677186c' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = '90a2ae5e-26e0-4ea5-a1a4-9c881c58e6ec'
WHERE id = '039c9c14-8a3b-47e3-a6ab-fededf66b175' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = '90a2ae5e-26e0-4ea5-a1a4-9c881c58e6ec'
WHERE id = 'bd635f27-a4dc-4d2a-a3fe-492b7f956589' AND kr_id IS NULL;

-- KR 65b4142d：内容生成 — AI每天产出≥5条内容（帖子+短文）
UPDATE okr_projects SET kr_id = '65b4142d-242b-457d-abfa-c0c38037f1e9'
WHERE id = 'b9b8e471-afe8-4090-8607-3dba52f7f09f' AND kr_id IS NULL;

-- KR 4b4d2262：自动发布 — 每天自动发到≥3个平台，发布成功率≥95%
UPDATE okr_projects SET kr_id = '4b4d2262-b250-4e7b-8044-00d02d2925a3'
WHERE id = '4aa421a7-15d9-4a6d-a536-750958be4981' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = '4b4d2262-b250-4e7b-8044-00d02d2925a3'
WHERE id = '74a3b30b-ee34-4b34-b494-1747117ca751' AND kr_id IS NULL;

-- KR ff1635d6：数据闭环 — 全平台数据采集+每周自动周报+分析驱动下轮选题
UPDATE okr_projects SET kr_id = 'ff1635d6-ad02-4223-a6a9-f6c044e39c72'
WHERE id = 'eb850d19-083c-4d78-bc00-99af3c6325dc' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = 'ff1635d6-ad02-4223-a6a9-f6c044e39c72'
WHERE id = '8b9fca8b-45a6-40f2-9c06-a37ff18fb1b3' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = 'ff1635d6-ad02-4223-a6a9-f6c044e39c72'
WHERE id = '6e9ed81c-582a-47c4-af83-40af1ae931bc' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = 'ff1635d6-ad02-4223-a6a9-f6c044e39c72'
WHERE id = '846b1dab-da22-4b01-86f3-4bbc51f1a6c5' AND kr_id IS NULL;

UPDATE okr_projects SET kr_id = 'ff1635d6-ad02-4223-a6a9-f6c044e39c72'
WHERE id = '389ddac3-9d22-48a6-8861-6d003c3859a4' AND kr_id IS NULL;
