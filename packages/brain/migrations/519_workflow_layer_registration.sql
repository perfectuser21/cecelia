-- 519: 流程层登记——旧树 ability 转成 workflows 流程，闹钟总账回填 workflow_id（框架标准 v2.0，任务 6741b288）
--
-- 背景：标准的树是 部门 → 价值流(journeys 无父) → 能力(journeys 有父) → 流程(workflows) → Activity(journey_steps)。
-- 旧树 journey_features 里的 ability（能力 × 平台/渠道）就是缺失的「流程」层；闹钟总账 517 之后只挂到了能力，
-- 没有流程可挂。本迁移：
--   ① workflows 加 legacy_feature_id 溯源列（指向旧 ability，精确回滚）；
--   ② 22 条旧 ability 逐条转成流程（挂到各自能力）；
--   ③ 每个"有闹钟但没有流程"的能力补一条默认「定时作业」流程（关键词获客复用既有 douyin_keyword_leadgen）；
--   ④ 闹钟先归位能力（未挂的按实际归位；11 条挂在「经营节奏」价值流上的 OKR 闹钟归到 G5 战略 OKR），
--      再按 能力→流程 回填 workflow_id（只填空值）；
--   ⑤ 旧树只标 deprecated 不删：PC 端发布套 21 条（决策 117660b0 整套淘汰）、与能力重名/重复行、已转换行
--      （workflow_ref 指向新流程 key）、smoke/e2e 测试垃圾；
--   ⑥ 昨日误建的两条重复能力（已有同义能力）标 deprecated，仅当其下无流程/闹钟/activity。
-- 所有 INSERT 带「能力存在」守卫：CI 用空库跑全量迁移时整段无害跳过。改前原值进 migration_519_backup，回滚按备份还原。
BEGIN;

-- ===== 溯源列
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS legacy_feature_id uuid NULL REFERENCES journey_features(id) ON DELETE SET NULL;
COMMENT ON COLUMN workflows.legacy_feature_id IS '由旧树 journey_features(ability) 转换而来时记录来源 id；回滚/对账用（迁移 519）';
CREATE INDEX IF NOT EXISTS idx_workflows_legacy_feature ON workflows (legacy_feature_id) WHERE legacy_feature_id IS NOT NULL;

-- ===== 备份（回滚依据）
CREATE TABLE IF NOT EXISTS migration_519_backup (
  table_name text NOT NULL,
  row_id     text NOT NULL,
  payload    jsonb NOT NULL,
  PRIMARY KEY (table_name, row_id)
);

INSERT INTO migration_519_backup (table_name, row_id, payload)
SELECT 'journey_features', id::text, jsonb_build_object('status', status, 'workflow_ref', workflow_ref)
  FROM journey_features
 WHERE status <> 'deprecated'
   AND (name LIKE '[smoke]%' OR name LIKE 'gp-agg-smoke%' OR name LIKE 'e2e-%'
     OR id IN (
      -- 已转换 22
      'ae16ed67-1e1a-47fb-9f31-b6bfec165480','f4f56de0-a51c-4778-a458-d9abb863f01a','c34f7f5a-8338-48c3-b043-77c3ddf5ff78',
      '8bfacdbd-c44c-4e35-bdab-83ce8f726afb','cf668390-b068-4250-9404-038aaa0ba810','2fd81a59-b1e8-4105-b49b-a1dcbf842c48',
      'd82e0352-ebf9-4879-8982-c0e4858552dc','c071614b-1562-4332-9c0b-937d845ed4d6','1e4ee48d-365d-4373-a4bc-86a20a917289',
      'f2913c7a-3da8-4d03-bb8f-0068c9a9d711','ee0b211c-46fc-4bdb-aaa4-cab6c46832e4','82a9cd0e-fb32-4498-a6a9-0e74402dc63a',
      '03dee814-e720-4b59-b5c2-61a6c426d8bd','0c78270b-0204-409e-9bef-466328c96c83','6c142e76-0b0c-4134-96e8-8e7c62b54a0e',
      'e8031829-4b2e-4fc5-802b-1734ee7c3431','52f8ce0a-348c-4d87-9b4d-013525657a5e','028570eb-b461-4bfe-802a-d450ab59de73',
      '5d019e98-5a97-4291-943e-9050d4bf88b7','c36467aa-c59a-4319-af21-b36c16b8d82b','228e77c0-4016-4936-9283-63c723c677b0',
      'd7b8b3c6-7ba3-4798-a9fa-2902e680a0de',
      -- 重复 11
      'b6f99758-ac17-48b8-82e2-98f95bcd5d49','de0a5313-94cb-476c-8de8-384971362164','cc3cef4d-4c61-4aa1-8e11-3a50011ca739',
      '74d1faac-c811-4462-a212-b73f711e00c1','49c7414c-8f5f-4581-b3f8-7882b483f501','1611c212-ff10-4680-930a-eded862a0d28',
      'c379bf9f-e6c4-470f-b45c-66a767c81eb7','80e78da8-6e53-409e-bc01-3231f9be8a21','83c23dd0-ce04-4aa6-8f7f-6f5b03a309f3',
      '1fd3c05d-0280-4fc3-a08f-709d5284a4d5','19e427c8-237f-4d1f-85b1-f33e0481b56c',
      -- PC 端发布套 21
      '1bbf5d4b-35f4-49a2-84f7-f5666163df90','8677b2d1-8887-4b7c-88ed-eea4e6a8afa9','fef041e5-4a8e-4c3d-9dbd-0842bc03325a',
      '74335c04-78b5-438c-983a-32db3ce52881','116a9fc6-0e93-423e-8a2c-b0e7664c6f12','01c89148-a084-4de1-8582-b474a38a726a',
      'fdb7c6e3-47da-4903-b990-75090c4a7153','3acfe778-b20d-4e83-a237-cb96fddb1fdf','4c736fe3-af2f-4a40-9787-e172a05e0e18',
      '2e65234b-fc45-42b0-b6f2-f0eefd7950d9','99d14f48-d229-4fed-86db-2530fab01fca','6a64605a-39dd-4931-a2e4-77640c57a513',
      '01321fec-0491-42a4-b2f1-32a73d674e3a','87a1b506-f472-4e89-9e43-0ecc6b7f3632','e82e5d65-913d-4bb5-a209-f184c3ebfc1b',
      '927f6ea0-f3a2-4b3b-99e0-8f5f07dafada','9906ba78-12d5-44dd-ab94-8a641323c1b4','f8d1f8a2-1fd0-4adf-b006-e6762e4950fb',
      'f02caa3a-6968-484d-8a2e-3deae7951789','eb80afc2-c231-4569-ab5c-4fd40a55b7f2','d7f8619e-2545-4033-b55c-81ff8ae6b1af'))
ON CONFLICT DO NOTHING;

INSERT INTO migration_519_backup (table_name, row_id, payload)
SELECT 'journeys', id::text, jsonb_build_object('status', status)
  FROM journeys
 WHERE id IN ('b8268218-920f-4a49-827b-4f739d8ea705','f41c3921-8fb7-408c-978f-1e02ee66ced1')
ON CONFLICT DO NOTHING;

INSERT INTO migration_519_backup (table_name, row_id, payload)
SELECT 'ops_schedule_entries', id::text,
       jsonb_build_object('journey_id', journey_id, 'workflow_id', workflow_id, 'tree_bucket_manual', tree_bucket_manual)
  FROM ops_schedule_entries
 WHERE journey_id = 'c5cb480f-f7f7-4b4e-8871-bd65ff65b668'
    OR (journey_id IS NOT NULL AND workflow_id IS NULL)
    OR id IN (113294, 71964, 71965, 73294, 71968, 71975, 71974, 166786, 172399, 71976, 71960, 71959, 71972, 73314,
              73297, 73298, 73295, 71969, 71963, 71971, 71970, 71973, 71957, 71962, 71958, 71967, 1,
              508333, 508360, 508275, 508403, 508393, 508307,
              279887, 279589, 278147, 278000, 527141, 545628, 64600)
ON CONFLICT DO NOTHING;

-- ===== 流程登记 A：旧 ability → 流程（legacy_feature_id 溯源）
-- 守卫：能力必须存在且是能力（有父）、旧 ability 行存在；key 已存在则跳过（幂等）。
INSERT INTO workflows (capability_id, key, name, channel, form, status, legacy_feature_id)
SELECT v.capability_id::uuid, v.key, v.name, v.channel, v.form, 'active', v.feature_id::uuid
  FROM (VALUES
  -- 智能发布 · 安卓工作机多平台发布（8 条，平台 × 安卓真机）
  ('bilibili_video_publish.android',        '24987ee5-53a0-4c37-946f-1b749954cac7', 'ae16ed67-1e1a-47fb-9f31-b6bfec165480', 'B站 · 视频投稿（安卓真机）',           'bilibili',        'android_rpa'),
  ('toutiao_video_publish.android',         '24987ee5-53a0-4c37-946f-1b749954cac7', 'f4f56de0-a51c-4778-a458-d9abb863f01a', '头条 · 视频发布（安卓真机）',           'toutiao',         'android_rpa'),
  ('xiaohongshu_video_publish.android',     '24987ee5-53a0-4c37-946f-1b749954cac7', 'c34f7f5a-8338-48c3-b043-77c3ddf5ff78', '小红书 · 视频发布（安卓真机）',         'xiaohongshu',     'android_rpa'),
  ('wechat_channels_video_publish.android', '24987ee5-53a0-4c37-946f-1b749954cac7', '8bfacdbd-c44c-4e35-bdab-83ce8f726afb', '视频号 · 视频发布（安卓真机）',         'wechat_channels', 'android_rpa'),
  ('weibo_video_publish.android',           '24987ee5-53a0-4c37-946f-1b749954cac7', 'cf668390-b068-4250-9404-038aaa0ba810', '微博 · 视频发布（安卓真机）',           'weibo',           'android_rpa'),
  ('kuaishou_video_publish.android',        '24987ee5-53a0-4c37-946f-1b749954cac7', '2fd81a59-b1e8-4105-b49b-a1dcbf842c48', '快手 · 视频发布（安卓真机）',           'kuaishou',        'android_rpa'),
  ('douyin_video_publish.android',          '24987ee5-53a0-4c37-946f-1b749954cac7', 'd82e0352-ebf9-4879-8982-c0e4858552dc', '抖音 · 视频发布（安卓真机）',           'douyin',          'android_rpa'),
  ('zhihu_video_publish.android',           '24987ee5-53a0-4c37-946f-1b749954cac7', 'c071614b-1562-4332-9c0b-937d845ed4d6', '知乎 · 视频发布（安卓真机）',           'zhihu',           'android_rpa'),
  -- 智能客服 GP-B ~ GP-F
  ('wechat_cs_reply_delivery',              'ac2e35bc-849a-48cd-917f-79d15c5ac886', '1e4ee48d-365d-4373-a4bc-86a20a917289', '微信客服 · 窗口可见+不抢焦点+真送达验证', 'wechat',        'windows_rpa'),
  ('wechat_moments_compose_publish',        '016459f9-98e0-40a2-a89e-92f8d34bb661', 'f2913c7a-3da8-4d03-bb8f-0068c9a9d711', '朋友圈制作 · 定时/手动→AI 文案草稿→审核台→真机发', 'wechat', 'android_rpa'),
  ('cs_ops_report',                         '3ae2414e-3e92-4471-9908-892245b4e37a', 'ee0b211c-46fc-4bdb-aaa4-cab6c46832e4', '客服日报/周报/月报 · 汇总→固化→中台看', 'internal',        'scheduled'),
  ('wechat_moments_engagement',             'b6a73832-b42b-4678-87ca-3ce00a6d70dd', '82a9cd0e-fb32-4498-a6a9-0e74402dc63a', '客户朋友圈互动 · AI 点赞/评论→真机执行', 'wechat',          'android_rpa'),
  ('wechat_group_ops',                      '8fe9ed6b-999a-4041-8126-8567f68d3dea', '03dee814-e720-4b59-b5c2-61a6c426d8bd', '社群运营 · 微信群（建群/公告/答疑/群发/踢广告）', 'wechat',  'android_rpa'),
  -- 员工知识中枢（三条既有能力）
  ('knowledge_collab_notes',                '4c1c7271-b31d-46a6-9492-5a39ff9ca490', '0c78270b-0204-409e-9bef-466328c96c83', '协同笔记',                               'web',             'app'),
  ('knowledge_experience_qa',               'c61db58c-7423-4cd5-b58d-6363cf9a49ea', '6c142e76-0b0c-4134-96e8-8e7c62b54a0e', '经验沉淀与问答',                         'web',             'app'),
  ('knowledge_structured_workbench',        '23a91349-18bf-4901-8e8f-ee0438e4c6db', 'e8031829-4b2e-4fc5-802b-1734ee7c3431', '结构化工作台',                           'web',             'app'),
  -- Shopify / 视频剪辑 / 视频翻拍
  ('shopify_product_draft_listing',         '6bd7e841-14bf-4630-b667-418c39a64918', '52f8ce0a-348c-4d87-9b4d-013525657a5e', 'Shopify · 商品上架（草稿创建）',         'shopify',         'api'),
  ('video_batch_remix',                     '8cb5e709-1c6d-4f1a-9320-94b51a91ed3b', '028570eb-b461-4bfe-802a-d450ab59de73', '批量混剪',                               'internal',        'pipeline'),
  ('video_remake_pipeline',                 '3cb652ee-2756-4bff-8fa2-27ef94da1555', '5d019e98-5a97-4291-943e-9050d4bf88b7', '视频翻拍 · 节点可视化流水线（含 9 节点 Canvas 骨架）', 'internal', 'pipeline'),
  -- 管家 / 工厂
  ('owner_dialog_loop',                     '8bb8252f-29b4-4c34-acb9-1accda7ddfcf', 'c36467aa-c59a-4319-af21-b36c16b8d82b', '主理人对话回路',                         'openclaw',        'conversation'),
  ('task_intake_and_dispatch',              'fad72424-8ca2-4587-979a-86aff1b6aceb', '228e77c0-4016-4936-9283-63c723c677b0', '任务统一入账与路由派发（Notion→Brain→路由→执行）', 'notion',  'api'),
  ('delivery_human_acceptance',             'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', 'd7b8b3c6-7ba3-4798-a9fa-2902e680a0de', '交付人工验收闭环（Notion）',             'notion',          'api')
  ) AS v(key, capability_id, feature_id, name, channel, form)
 WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = v.capability_id::uuid AND j.parent_journey_id IS NOT NULL)
   AND EXISTS (SELECT 1 FROM journey_features f WHERE f.id = v.feature_id::uuid)
ON CONFLICT (key) DO NOTHING;

-- ===== 流程登记 B：有闹钟但没有流程的能力 → 默认「定时作业」流程
-- 关键词获客（a1000000-…0001）已有 douyin_keyword_leadgen，不新建。
INSERT INTO workflows (capability_id, key, name, channel, form, status)
SELECT v.capability_id::uuid, v.key, v.name, 'internal', 'scheduled', 'active'
  FROM (VALUES
  ('content_calendar_ops',           '72e8fec9-4757-4242-a87a-53d99fc7a414', '内容日历与创作 · 定时作业'),
  ('factory_f0_ops',                 '743f0e7c-d551-4105-8126-6b32de096f71', 'F0 提案拍板闭环 · 定时作业'),
  ('factory_f1_ops',                 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', 'F1 开发闭环 · 调度与看护'),
  ('factory_f2_ops',                 '2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6', 'F2 部署闭环 · 定时作业'),
  ('factory_f3_ops',                 'ec4eb591-e064-4886-a7b6-4452cdf333d2', 'F3 夜间体检 · 定时作业'),
  ('factory_f4_ops',                 '91c17939-225c-4491-92f3-67d8b0ace4d9', 'F4 故障自愈 · 定时作业'),
  ('factory_mj5_ops',                '51754939-247e-4b22-8f93-f8464a8eb985', 'MJ5 承诺地图闭环 · 定时作业'),
  ('skill_lifecycle_ops',            '9fcd257a-5c41-4477-98e0-fbae37e63d8d', '技能生命周期 · 周评审与缺口扫描'),
  ('customer_first_success_ops',     '6e63f204-e9fd-4a3b-b338-6b3616bfcc61', '客户首次成功路径 · 编排台同步与 E2E'),
  ('publish_account_session_ops',    '52b94922-6da5-4532-9f25-135d36d04bdc', '发布账号与会话维护 · 定时作业'),
  ('butler_g1_cockpit_ops',          '8bb8252f-29b4-4c34-acb9-1accda7ddfcf', 'G1 指挥舱 · 采集与推送'),
  ('butler_g2_inbox_ops',            '824ee0f5-aeb9-4972-909d-37dd17b75617', 'G2 收件箱归位 · 定时作业'),
  ('butler_g4_memory_ops',           'a824b567-b05e-432d-9d83-0fafbc941e78', 'G4 记忆与知识 · 定时作业'),
  ('okr_kr_sync_ops',                'dddddddd-f0f0-4000-8000-000000000004', 'G5 战略 OKR · KR 同步与投影'),
  ('infra_distribution_sync_ops',    '698ca310-a757-4138-95ab-06be961a2466', '分发与同步 · 定时作业'),
  ('infra_backup_restore_ops',       'dfb33785-0560-4fbe-9363-5865e89f3fcd', '备份与恢复 · 定时作业'),
  ('infra_runner_pool_ops',          '0c1f70f1-b061-4118-b741-8a31c1791c68', '执行资源池 · 看护与派发'),
  ('infra_data_projection_ops',      '3fe0e30d-c587-4108-8646-3bd019273bd3', '数据投影与同步 · 定时作业'),
  ('infra_cleanup_capacity_ops',     '55cb3b8d-200c-445f-9467-616498b40521', '清理与容量 · 定时作业'),
  ('infra_monitoring_alerting_ops',  '5b6d89cf-d972-4ef4-902e-c0f595f29465', '监控与告警 · 定时作业'),
  ('infra_network_ingress_ops',      '11b937df-7dfd-4c4d-b781-a8e229cf71e6', '网络与入口 · 定时作业'),
  ('infra_device_phone_ledger_ops',  '2173a385-a743-41f3-bb7d-d0e4b1d51d4e', '设备与手机台账 · 定时作业'),
  ('infra_account_credentials_ops',  '10c02ccf-46f1-4ecc-895b-7f397547d575', '账号与凭据 · 定时作业'),
  ('biz_rhythm_meetings_ops',        '2d123dbe-f618-4986-a152-e8529149aef7', '经营例会 · 班会定时'),
  ('biz_object_ledger_ops',          '0ab907a0-41b6-4cf3-9486-2fd976611574', '经营对象管理 · 台账同步'),
  ('biz_broadcast_ops',              '01368ac4-4b6f-4628-b8be-ac7a82542913', '经营播报 · 晨报/收盘/周报')
  ) AS v(key, capability_id, name)
 WHERE EXISTS (SELECT 1 FROM journeys j WHERE j.id = v.capability_id::uuid AND j.parent_journey_id IS NOT NULL)
ON CONFLICT (key) DO NOTHING;

-- ===== 闹钟归位能力（未挂的按实际归位；只改空值，不覆盖已有归位）
-- 经营节奏价值流上的 11 条 OKR/KR 闹钟 → G5 战略 OKR（价值流不是挂点）
UPDATE ops_schedule_entries SET journey_id = 'dddddddd-f0f0-4000-8000-000000000004', updated_at = NOW()
 WHERE journey_id = 'c5cb480f-f7f7-4b4e-8871-bd65ff65b668'
   AND EXISTS (SELECT 1 FROM journeys WHERE id = 'dddddddd-f0f0-4000-8000-000000000004');

UPDATE ops_schedule_entries e SET journey_id = v.capability_id::uuid, tree_bucket_manual = NULL, updated_at = NOW()
  FROM (VALUES
  -- 管家 · 任务流转：秋米路由 / Notion 委派
  (113294, 'fad72424-8ca2-4587-979a-86aff1b6aceb'), (73314, 'fad72424-8ca2-4587-979a-86aff1b6aceb'),
  -- 系统运行保障 · 执行资源池：OrbStack / runner / openclaw 重启 / bridge / pm2 / worker-daemon / mcp-reaper
  (71964, '0c1f70f1-b061-4118-b741-8a31c1791c68'), (71962, '0c1f70f1-b061-4118-b741-8a31c1791c68'),
  (73295, '0c1f70f1-b061-4118-b741-8a31c1791c68'), (1, '0c1f70f1-b061-4118-b741-8a31c1791c68'),
  (508333, '0c1f70f1-b061-4118-b741-8a31c1791c68'), (508360, '0c1f70f1-b061-4118-b741-8a31c1791c68'),
  (508275, '0c1f70f1-b061-4118-b741-8a31c1791c68'),
  -- 系统运行保障 · 监控与告警：keepalive / dead-man-switch / 盘水位采样
  (71965, '5b6d89cf-d972-4ef4-902e-c0f595f29465'), (71968, '5b6d89cf-d972-4ef4-902e-c0f595f29465'),
  (71976, '5b6d89cf-d972-4ef4-902e-c0f595f29465'),
  -- 系统运行保障 · 清理与容量：db-slim / drop_caches / builder prune / 孤儿插件目录 / janitor / preview-reaper
  (73294, '55cb3b8d-200c-445f-9467-616498b40521'), (71975, '55cb3b8d-200c-445f-9467-616498b40521'),
  (71974, '55cb3b8d-200c-445f-9467-616498b40521'), (166786, '55cb3b8d-200c-445f-9467-616498b40521'),
  (71960, '55cb3b8d-200c-445f-9467-616498b40521'), (71959, '55cb3b8d-200c-445f-9467-616498b40521'),
  (71969, '55cb3b8d-200c-445f-9467-616498b40521'),
  -- 系统运行保障 · 分发与同步：skills rsync 到西安两台 Mac / sync-to-hk
  (172399, '698ca310-a757-4138-95ab-06be961a2466'), (71958, '698ca310-a757-4138-95ab-06be961a2466'),
  -- 系统运行保障 · 数据投影与同步：仓库登记表扫描
  (71971, '3fe0e30d-c587-4108-8646-3bd019273bd3'), (71970, '3fe0e30d-c587-4108-8646-3bd019273bd3'),
  (71973, '3fe0e30d-c587-4108-8646-3bd019273bd3'),
  -- 系统运行保障 · 账号与凭据 / 网络与入口
  (71963, '10c02ccf-46f1-4ecc-895b-7f397547d575'), (71967, '11b937df-7dfd-4c4d-b781-a8e229cf71e6'),
  -- 工厂 · F1：主仓哨兵
  (71972, 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'),
  -- 经营节奏 · 经营对象管理：OPC 台账/对话同步
  (73297, '0ab907a0-41b6-4cf3-9486-2fd976611574'), (73298, '0ab907a0-41b6-4cf3-9486-2fd976611574'),
  -- 内容生产 · 内容日历与创作：OpenClaw 一次性内容任务
  (279887, '72e8fec9-4757-4242-a87a-53d99fc7a414'), (279589, '72e8fec9-4757-4242-a87a-53d99fc7a414'),
  (278147, '72e8fec9-4757-4242-a87a-53d99fc7a414'), (278000, '72e8fec9-4757-4242-a87a-53d99fc7a414'),
  -- 关键词获客：escort 看护
  (527141, 'a1000000-0000-4000-8000-000000000001'), (545628, 'a1000000-0000-4000-8000-000000000001'),
  -- 经营节奏 · 经营播报：收盘报告（原标个人区，实为公司经营播报）
  (64600, '01368ac4-4b6f-4628-b8be-ac7a82542913')
  ) AS v(id, capability_id)
 WHERE e.id = v.id
   AND e.journey_id IS NULL
   AND EXISTS (SELECT 1 FROM journeys j WHERE j.id = v.capability_id::uuid AND j.parent_journey_id IS NOT NULL);

-- 不进公司树 / 淘汰方案（人工列只在为空时写，已有人工判定不覆盖）
UPDATE ops_schedule_entries SET tree_bucket_manual = '个人区（不进公司树）', updated_at = NOW()
 WHERE id = 71957 AND journey_id IS NULL AND tree_bucket_manual IS NULL;            -- 投资系统 run_daily.py
UPDATE ops_schedule_entries SET tree_bucket_manual = '无（淘汰方案）', updated_at = NOW()
 WHERE id IN (508403, 508393, 508307) AND journey_id IS NULL                          -- xian-pc TestPublish / WeChatScheduler / n8n 触发器
   AND (tree_bucket_manual IS NULL OR tree_bucket_manual IN ('无', '无（游离脚本；私域客服候选，未登记）'));

-- ===== 闹钟回填 workflow_id（能力 → 该能力的默认流程；只填空值）
UPDATE ops_schedule_entries e
   SET workflow_id = w.id, updated_at = NOW()
  FROM (VALUES
  ('douyin_keyword_leadgen',         'a1000000-0000-4000-8000-000000000001'),
  ('wechat_cs_reply_delivery',       'ac2e35bc-849a-48cd-917f-79d15c5ac886'),
  ('wechat_moments_compose_publish', '016459f9-98e0-40a2-a89e-92f8d34bb661'),
  ('cs_ops_report',                  '3ae2414e-3e92-4471-9908-892245b4e37a'),
  ('task_intake_and_dispatch',       'fad72424-8ca2-4587-979a-86aff1b6aceb'),
  ('content_calendar_ops',           '72e8fec9-4757-4242-a87a-53d99fc7a414'),
  ('factory_f0_ops',                 '743f0e7c-d551-4105-8126-6b32de096f71'),
  ('factory_f1_ops',                 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'),
  ('factory_f2_ops',                 '2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6'),
  ('factory_f3_ops',                 'ec4eb591-e064-4886-a7b6-4452cdf333d2'),
  ('factory_f4_ops',                 '91c17939-225c-4491-92f3-67d8b0ace4d9'),
  ('factory_mj5_ops',                '51754939-247e-4b22-8f93-f8464a8eb985'),
  ('skill_lifecycle_ops',            '9fcd257a-5c41-4477-98e0-fbae37e63d8d'),
  ('customer_first_success_ops',     '6e63f204-e9fd-4a3b-b338-6b3616bfcc61'),
  ('publish_account_session_ops',    '52b94922-6da5-4532-9f25-135d36d04bdc'),
  ('butler_g1_cockpit_ops',          '8bb8252f-29b4-4c34-acb9-1accda7ddfcf'),
  ('butler_g2_inbox_ops',            '824ee0f5-aeb9-4972-909d-37dd17b75617'),
  ('butler_g4_memory_ops',           'a824b567-b05e-432d-9d83-0fafbc941e78'),
  ('okr_kr_sync_ops',                'dddddddd-f0f0-4000-8000-000000000004'),
  ('infra_distribution_sync_ops',    '698ca310-a757-4138-95ab-06be961a2466'),
  ('infra_backup_restore_ops',       'dfb33785-0560-4fbe-9363-5865e89f3fcd'),
  ('infra_runner_pool_ops',          '0c1f70f1-b061-4118-b741-8a31c1791c68'),
  ('infra_data_projection_ops',      '3fe0e30d-c587-4108-8646-3bd019273bd3'),
  ('infra_cleanup_capacity_ops',     '55cb3b8d-200c-445f-9467-616498b40521'),
  ('infra_monitoring_alerting_ops',  '5b6d89cf-d972-4ef4-902e-c0f595f29465'),
  ('infra_network_ingress_ops',      '11b937df-7dfd-4c4d-b781-a8e229cf71e6'),
  ('infra_device_phone_ledger_ops',  '2173a385-a743-41f3-bb7d-d0e4b1d51d4e'),
  ('infra_account_credentials_ops',  '10c02ccf-46f1-4ecc-895b-7f397547d575'),
  ('biz_rhythm_meetings_ops',        '2d123dbe-f618-4986-a152-e8529149aef7'),
  ('biz_object_ledger_ops',          '0ab907a0-41b6-4cf3-9486-2fd976611574'),
  ('biz_broadcast_ops',              '01368ac4-4b6f-4628-b8be-ac7a82542913')
  ) AS m(key, capability_id)
  JOIN workflows w ON w.key = m.key
 WHERE e.journey_id = m.capability_id::uuid
   AND e.workflow_id IS NULL;

-- ===== journey_features 退役（旧树只标不删；status CHECK 含 deprecated）
-- 已转换 22 条：workflow_ref 指向新流程 key
UPDATE journey_features f
   SET status = 'deprecated', workflow_ref = v.ref, updated_at = NOW()
  FROM (VALUES
  ('ae16ed67-1e1a-47fb-9f31-b6bfec165480', 'workflow:bilibili_video_publish.android'),
  ('f4f56de0-a51c-4778-a458-d9abb863f01a', 'workflow:toutiao_video_publish.android'),
  ('c34f7f5a-8338-48c3-b043-77c3ddf5ff78', 'workflow:xiaohongshu_video_publish.android'),
  ('8bfacdbd-c44c-4e35-bdab-83ce8f726afb', 'workflow:wechat_channels_video_publish.android'),
  ('cf668390-b068-4250-9404-038aaa0ba810', 'workflow:weibo_video_publish.android'),
  ('2fd81a59-b1e8-4105-b49b-a1dcbf842c48', 'workflow:kuaishou_video_publish.android'),
  ('d82e0352-ebf9-4879-8982-c0e4858552dc', 'workflow:douyin_video_publish.android'),
  ('c071614b-1562-4332-9c0b-937d845ed4d6', 'workflow:zhihu_video_publish.android'),
  ('1e4ee48d-365d-4373-a4bc-86a20a917289', 'workflow:wechat_cs_reply_delivery'),
  ('f2913c7a-3da8-4d03-bb8f-0068c9a9d711', 'workflow:wechat_moments_compose_publish'),
  ('ee0b211c-46fc-4bdb-aaa4-cab6c46832e4', 'workflow:cs_ops_report'),
  ('82a9cd0e-fb32-4498-a6a9-0e74402dc63a', 'workflow:wechat_moments_engagement'),
  ('03dee814-e720-4b59-b5c2-61a6c426d8bd', 'workflow:wechat_group_ops'),
  ('0c78270b-0204-409e-9bef-466328c96c83', 'workflow:knowledge_collab_notes'),
  ('6c142e76-0b0c-4134-96e8-8e7c62b54a0e', 'workflow:knowledge_experience_qa'),
  ('e8031829-4b2e-4fc5-802b-1734ee7c3431', 'workflow:knowledge_structured_workbench'),
  ('52f8ce0a-348c-4d87-9b4d-013525657a5e', 'workflow:shopify_product_draft_listing'),
  ('028570eb-b461-4bfe-802a-d450ab59de73', 'workflow:video_batch_remix'),
  ('5d019e98-5a97-4291-943e-9050d4bf88b7', 'workflow:video_remake_pipeline'),
  ('c36467aa-c59a-4319-af21-b36c16b8d82b', 'workflow:owner_dialog_loop'),
  ('228e77c0-4016-4936-9283-63c723c677b0', 'workflow:task_intake_and_dispatch'),
  ('d7b8b3c6-7ba3-4798-a9fa-2902e680a0de', 'workflow:delivery_human_acceptance')
  ) AS v(feature_id, ref)
 WHERE f.id = v.feature_id::uuid
   AND f.status <> 'deprecated';

-- 与能力重名的 GP-B~F 五条 + 已转换行的重复行 + Canvas 骨架（并入 video_remake_pipeline）
UPDATE journey_features SET status = 'deprecated', updated_at = NOW()
 WHERE status <> 'deprecated'
   AND id IN (
    'b6f99758-ac17-48b8-82e2-98f95bcd5d49','de0a5313-94cb-476c-8de8-384971362164','cc3cef4d-4c61-4aa1-8e11-3a50011ca739',
    '74d1faac-c811-4462-a212-b73f711e00c1','49c7414c-8f5f-4581-b3f8-7882b483f501',
    '1611c212-ff10-4680-930a-eded862a0d28','c379bf9f-e6c4-470f-b45c-66a767c81eb7','80e78da8-6e53-409e-bc01-3231f9be8a21',
    '83c23dd0-ce04-4aa6-8f7f-6f5b03a309f3','1fd3c05d-0280-4fc3-a08f-709d5284a4d5','19e427c8-237f-4d1f-85b1-f33e0481b56c');

-- PC 端发布套 21 条（决策 117660b0：整套淘汰；朋友圈已在安卓，智能客服另保留）
UPDATE journey_features SET status = 'deprecated', updated_at = NOW()
 WHERE status <> 'deprecated'
   AND id IN (
    '1bbf5d4b-35f4-49a2-84f7-f5666163df90','8677b2d1-8887-4b7c-88ed-eea4e6a8afa9','fef041e5-4a8e-4c3d-9dbd-0842bc03325a',
    '74335c04-78b5-438c-983a-32db3ce52881','116a9fc6-0e93-423e-8a2c-b0e7664c6f12','01c89148-a084-4de1-8582-b474a38a726a',
    'fdb7c6e3-47da-4903-b990-75090c4a7153','3acfe778-b20d-4e83-a237-cb96fddb1fdf','4c736fe3-af2f-4a40-9787-e172a05e0e18',
    '2e65234b-fc45-42b0-b6f2-f0eefd7950d9','99d14f48-d229-4fed-86db-2530fab01fca','6a64605a-39dd-4931-a2e4-77640c57a513',
    '01321fec-0491-42a4-b2f1-32a73d674e3a','87a1b506-f472-4e89-9e43-0ecc6b7f3632','e82e5d65-913d-4bb5-a209-f184c3ebfc1b',
    '927f6ea0-f3a2-4b3b-99e0-8f5f07dafada','9906ba78-12d5-44dd-ab94-8a641323c1b4','f8d1f8a2-1fd0-4adf-b006-e6762e4950fb',
    'f02caa3a-6968-484d-8a2e-3deae7951789','eb80afc2-c231-4569-ab5c-4fd40a55b7f2','d7f8619e-2545-4033-b55c-81ff8ae6b1af');

-- smoke / e2e 测试垃圾
UPDATE journey_features SET status = 'deprecated', updated_at = NOW()
 WHERE status <> 'deprecated'
   AND (name LIKE '[smoke]%' OR name LIKE 'gp-agg-smoke%' OR name LIKE 'e2e-%');

-- ===== 重复能力退役（2026-10-05 误建；已有 协同笔记/经验沉淀/结构化工作台、批量混剪/视频剪辑流水线 同义能力）
UPDATE journeys SET status = 'deprecated', updated_at = NOW()
 WHERE id IN ('b8268218-920f-4a49-827b-4f739d8ea705','f41c3921-8fb7-408c-978f-1e02ee66ced1')
   AND status <> 'deprecated'
   AND NOT EXISTS (SELECT 1 FROM workflows w WHERE w.capability_id = journeys.id)
   AND NOT EXISTS (SELECT 1 FROM ops_schedule_entries e WHERE e.journey_id = journeys.id)
   AND NOT EXISTS (SELECT 1 FROM journey_steps s WHERE s.journey_id = journeys.id);

INSERT INTO schema_version (version, description)
VALUES ('519', '流程层登记：旧 ability → workflows、默认定时作业流程、闹钟总账回填 workflow_id、旧树标 deprecated')
ON CONFLICT (version) DO NOTHING;

COMMIT;
