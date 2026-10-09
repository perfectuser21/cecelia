-- 454: 注册表数据订正（三面模型上线首夜守夜 dryRun 实测，任务 3858a631）
-- ① 设备清单：brain_table 曾登记为 machines，但 cecelia 库根本没有这张表——真身是
--    ~/bin/phone-registry-mirror.sh 每小时直写 Notion（Tailscale/设备探针），Brain 侧无账。
--    改为 brain_table=NULL，A10 不再拿不存在的表去比；镜子面不变（仍禁人手改状态列）。
-- ② AI Notes：除 decisions / initiative_contracts 两根推送血管外，routes/notes.js 三处
--    直接 POST /pages 建页并 INSERT notes 表但不存 notion_id——第三根血管一直没登记，
--    也是 AI Notes 里 7000+ 页在 decisions/initiative_contracts 找不到对应行的来源。
--    登记为 push / reconcile none，让账里"对不上"变成"已知不可对"，而不是"不知道"。
UPDATE notion_projection_map
   SET brain_table = NULL,
       notes = 'Brain 无 machines 表；真身=phone-registry-mirror.sh 探针直写。名称/归属/备注人可写，在线状态/电量/心跳=镜子专属'
 WHERE notion_db_id = '3d4c40c2-ba63-816d-b72d-d520f2cd090a' AND brain_table = 'machines';

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, reconcile, notes) VALUES
('185c40c2-ba63-828c-973f-81a9c4582cd6','AI Notes','mirror','notes','push','routes/notes.js(POST /api/brain/notes 直建页)','active','system','{"mode":"none","reason":"notes 表不存 notion_id，无法逐行对账"}','与 decisions/initiative_contracts 同库的第三根血管；要对账须先给 notes 加 notion_id 列并在路由里回存')
ON CONFLICT (notion_db_id, COALESCE(brain_table, '')) DO NOTHING;
