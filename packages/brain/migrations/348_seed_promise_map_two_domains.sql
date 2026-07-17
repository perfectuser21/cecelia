-- packages/brain/migrations/348_seed_promise_map_two_domains.sql
-- MJ5 刀1：两打样域落库（智能客服 Line04 + 公司级首次成功）。幂等 + 空库自足。
-- 数据 SSOT：V4 骨干 artifact c9754f42 / 全景四个家 4e744c89 / GP-B 总表 93a47469

-- ① 存量域锚（生产已存在→仅补列；空库→同 UUID 兜底创建）
INSERT INTO journeys (id, name, journey_type, maturity, status)
VALUES
  ('bfeed805-deed-46c3-8624-87f0028101d4','客户私域 AI 接管','user_facing','skeleton','active'),
  ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61','客户首次成功路径','user_facing','mvp','active')
ON CONFLICT (id) DO NOTHING;

UPDATE journeys SET domain='智能客服', updated_at=NOW()
 WHERE id='bfeed805-deed-46c3-8624-87f0028101d4';
UPDATE journeys SET domain='公司级', home='biz', trigger='客户签约开通',
       endpoint='客户自己会看 Dashboard，了解经营情况', updated_at=NOW()
 WHERE id='6e63f204-e9fd-4a3b-b338-6b3616bfcc61';

-- ② 5 条 GP + 家②（trigger/endpoint 取 V4 原文）
INSERT INTO journeys (id, name, journey_type, maturity, status, home, domain, trigger, endpoint) VALUES
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886','智能客服 · GP-B 被动接待','user_facing','skeleton','active','biz','智能客服','客户发来消息','客户收到得体回复（或真人接手），这笔互动老板可查'),
 ('016459f9-98e0-40a2-a89e-92f8d34bb661','智能客服 · GP-C 朋友圈发布','user_facing','skeleton','active','biz','智能客服','到了该发内容的时候（内容日历/老板指令）','一条像人发的朋友圈，出现在客户能看到的地方'),
 ('3ae2414e-3e92-4471-9908-892245b4e37a','智能客服 · GP-D 经营汇报','user_facing','skeleton','active','biz','智能客服','到汇报时间（日/周/月）','老板按时收到一份真实反映经营情况的报告'),
 ('b6a73832-b42b-4678-87ca-3ce00a6d70dd','智能客服 · GP-E 朋友圈互动','user_facing','skeleton','active','biz','智能客服','客户发了朋友圈','客户感到被关注，关系升温且不越界'),
 ('8fe9ed6b-999a-4041-8126-8567f68d3dea','智能客服 · GP-F 社群运营','user_facing','skeleton','active','biz','智能客服','群里出现需要响应的动静','群保持健康有序，客户问题被接住'),
 ('6df5b884-2ae1-4801-95e8-bb7a11f308d2','智能客服 · 绑定/安装（共享前置）','user_facing','mvp','active','pre','智能客服','新客户开通后首次进场','Agent 连上中台、账号绑定完成，可进任何业务路')
ON CONFLICT (id) DO NOTHING;

-- ③ steps（promise=V4 原文；ON CONFLICT 只补 promise，存量 name/status 零丢失）
INSERT INTO journey_steps (journey_id, step_number, name, status, promise) VALUES
 -- GP-B
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886',1,'消息被感知','in_progress','客户发来的任何消息，系统数秒内看到，一条不漏、一条不重'),
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886',2,'决定谁来答','in_progress','AI 能答的 AI 答；该转人的一定转到人，而且人接得住'),
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886',3,'回复送达','in_progress','客户收到一条得体、及时、真的送到了的回复'),
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886',4,'留痕与善后','in_progress','每次对话进账本：CRM 已回填、异常（被拉黑/罢工）会有人知道'),
 -- GP-C
 ('016459f9-98e0-40a2-a89e-92f8d34bb661',1,'内容成稿','in_progress','到点就有一条拿得出手的内容稿'),
 ('016459f9-98e0-40a2-a89e-92f8d34bb661',2,'发布上圈','in_progress','稿子真的发出去了，图文完整'),
 ('016459f9-98e0-40a2-a89e-92f8d34bb661',3,'发布确认与留痕','planned','发没发成功、发了什么，老板可查'),
 -- GP-D
 ('3ae2414e-3e92-4471-9908-892245b4e37a',1,'数据齐备','in_progress','报告依据的数据是全的、新的'),
 ('3ae2414e-3e92-4471-9908-892245b4e37a',2,'报告生成','in_progress','到点自动出稿，人话、可决策'),
 ('3ae2414e-3e92-4471-9908-892245b4e37a',3,'送达老板','planned','报告真的到了老板手上（不是躺在数据库里）'),
 -- GP-E
 ('b6a73832-b42b-4678-87ca-3ce00a6d70dd',1,'客户动态被感知','planned','重点客户的朋友圈动态不漏看'),
 ('b6a73832-b42b-4678-87ca-3ce00a6d70dd',2,'互动决策','in_progress','该点赞的点、该评论的出稿，不该出手的绝不出手'),
 ('b6a73832-b42b-4678-87ca-3ce00a6d70dd',3,'互动执行与留痕','planned','互动真的发生了，并记进客户关系账'),
 -- GP-F
 ('8fe9ed6b-999a-4041-8126-8567f68d3dea',1,'群动静被感知','planned','白名单群里的关键动静不漏看'),
 ('8fe9ed6b-999a-4041-8126-8567f68d3dea',2,'响应与治理','planned','该答的答、该管的管（广告号出局），不吵不越界'),
 ('8fe9ed6b-999a-4041-8126-8567f68d3dea',3,'留痕','planned','群里发生了什么、处理了什么，老板可查'),
 -- 家② 绑定/安装
 ('6df5b884-2ae1-4801-95e8-bb7a11f308d2',1,'注册自动登录','done','注册即登录，无需人工开通'),
 ('6df5b884-2ae1-4801-95e8-bb7a11f308d2',2,'装客户端 + Agent 连中台','done','装完客户端，Agent 自动连上中台'),
 ('6df5b884-2ae1-4801-95e8-bb7a11f308d2',3,'扫码绑抖音主号','done','扫码即绑定主号，进场完成'),
 -- 首次成功（S2 与存量行冲突→只补 promise）
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',1,'开通','done','客户签约后当天完成开通，进场凭据就绪'),
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',2,'装好连上','done','装完客户端，Agent 自动连上中台'),
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',3,'绑资产','done','客户的账号与素材资产绑定完成'),
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',4,'第一次价值（按线参数化）','in_progress','客户拿到第一次可感知的业务价值（按业务线参数化）'),
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',5,'会看 dashboard','in_progress','客户自己会看 Dashboard 了解经营情况')
ON CONFLICT (journey_id, step_number) DO UPDATE SET promise=EXCLUDED.promise, updated_at=NOW();

-- ④ 家②件 + 家③ 7 底座件（状态映射：已亮→working / 半成→building / 待出生→planned）
INSERT INTO journey_features (id, name, journey_id, kind, thickness, status, "group") VALUES
 ('24a98312-1941-4a0b-91c9-8bf79ef47311','绑定/安装（共享前置）','6df5b884-2ae1-4801-95e8-bb7a11f308d2','feature','thin','working','家②共享前置'),
 ('6691d09a-3525-4610-87d2-2d8261d68111','消息/动态采集通道','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','working','家③横切件池'),
 ('0d4922c9-0a5e-4aa6-93ff-6e1911342622','Agent 运行时底座（启动状态恢复·开机自检·保活重连）','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','planned','家③横切件池'),
 ('2dde3bb5-2cb9-4c33-b592-224b1f4ffe41','后台静默发送通道','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','working','家③横切件池'),
 ('7f680eb3-0866-4429-a600-b396e980fc59','接管开关','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','working','家③横切件池'),
 ('d831dd0f-893c-49b6-8857-07756f5a7030','客户画像卡','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','planned','家③横切件池'),
 ('0b70f2ff-1a16-4029-a71a-e6cb5a523ea2','CRM 表底座','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','building','家③横切件池'),
 ('39130340-16f0-47f1-9779-fc0b57218dd0','记忆库租户隔离（不变量）','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','working','家③横切件池')
ON CONFLICT (id) DO NOTHING;

-- ⑤ 格子（cells）：cell 行 notion_synced_at=NOW() 不推 Notion；幂等键=(step_id,cell_kind,cell_key)
WITH gp(letter, jid) AS (VALUES
  ('B','ac2e35bc-849a-48cd-917f-79d15c5ac886'::uuid),
  ('C','016459f9-98e0-40a2-a89e-92f8d34bb661'::uuid),
  ('D','3ae2414e-3e92-4471-9908-892245b4e37a'::uuid),
  ('E','b6a73832-b42b-4678-87ca-3ce00a6d70dd'::uuid),
  ('F','8fe9ed6b-999a-4041-8126-8567f68d3dea'::uuid),
  ('FS','6e63f204-e9fd-4a3b-b338-6b3616bfcc61'::uuid)
),
cell_data(letter, step_no, ckind, ckey, cstatus, fid, aref, nar) AS (VALUES
  -- ===== GP-B S1（总表）=====
  ('B',1,'capability','文字','green',NULL::uuid,NULL,NULL),
  ('B',1,'capability','图片','gray',NULL,NULL,NULL),
  ('B',1,'capability','语音','gray',NULL,NULL,NULL),
  ('B',1,'capability','表情','gray',NULL,NULL,NULL),
  ('B',1,'capability','链接','gray',NULL,NULL,NULL),
  ('B',1,'capability','红包','gray',NULL,NULL,NULL),
  ('B',1,'capability','转账','gray',NULL,NULL,NULL),
  ('B',1,'capability','文件','gray',NULL,NULL,NULL),
  ('B',1,'element','FR','pending',NULL,NULL,NULL),
  ('B',1,'element','NFR','green',NULL,NULL,NULL),
  ('B',1,'element','判定点','pending',NULL,NULL,NULL),
  ('B',1,'element','两轴衔接','red',NULL,NULL,NULL),
  ('B',1,'element','不变量','green',NULL,NULL,NULL),
  ('B',1,'element','失败语义','red',NULL,NULL,NULL),
  ('B',1,'element','死亡告警','red',NULL,NULL,NULL),
  ('B',1,'element','效果确认','red',NULL,NULL,NULL),
  ('B',1,'element','对抗面','red',NULL,NULL,NULL),
  ('B',1,'element','保质期','red',NULL,NULL,NULL),
  ('B',1,'scenario','日常','green',NULL,NULL,NULL),
  ('B',1,'scenario','首次','green',NULL,NULL,NULL),
  ('B',1,'scenario','重启','red',NULL,NULL,NULL),
  ('B',1,'scenario','断网','red',NULL,NULL,NULL),
  ('B',1,'scenario','洪峰','red',NULL,NULL,NULL),
  ('B',1,'scenario','平台改版','red',NULL,NULL,NULL),
  ('B',1,'scenario','凭据过期','gray',NULL,NULL,'本步不涉及凭据'),
  ('B',1,'base_ref','消息/动态采集通道','green','6691d09a-3525-4610-87d2-2d8261d68111',NULL,NULL),
  ('B',1,'base_ref','Agent 运行时底座','gray','0d4922c9-0a5e-4aa6-93ff-6e1911342622',NULL,NULL),
  ('B',1,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL),
  -- ===== GP-B S2 =====
  ('B',2,'capability','怒/诉/退→转人工','green',NULL,NULL,NULL),
  ('B',2,'capability','CRM 分级依据','pending',NULL,NULL,NULL),
  ('B',2,'capability','客户画像卡（体验件）','gray',NULL,NULL,NULL),
  ('B',2,'element','FR','green',NULL,NULL,NULL),
  ('B',2,'element','NFR','red',NULL,NULL,NULL),
  ('B',2,'element','判定点','pending',NULL,'eval:模糊承诺-该不该转LLM判,评测集待建',NULL),
  ('B',2,'element','两轴衔接','gray',NULL,NULL,'本步不跨 lane'),
  ('B',2,'element','不变量','green',NULL,NULL,NULL),
  ('B',2,'element','失败语义','red',NULL,NULL,NULL),
  ('B',2,'element','死亡告警','red',NULL,NULL,NULL),
  ('B',2,'element','效果确认','red',NULL,NULL,NULL),
  ('B',2,'element','对抗面','red',NULL,NULL,NULL),
  ('B',2,'element','保质期','red',NULL,NULL,NULL),
  ('B',2,'scenario','日常','green',NULL,NULL,NULL),
  ('B',2,'scenario','人不在线','red',NULL,NULL,NULL),
  ('B',2,'scenario','对抗输入','red',NULL,NULL,NULL),
  ('B',2,'scenario','重启','gray',NULL,NULL,'本步无状态可恢复'),
  ('B',2,'base_ref','接管开关','green','7f680eb3-0866-4429-a600-b396e980fc59',NULL,NULL),
  ('B',2,'base_ref','客户画像卡','gray','d831dd0f-893c-49b6-8857-07756f5a7030',NULL,NULL),
  ('B',2,'base_ref','CRM 表底座','pending','0b70f2ff-1a16-4029-a71a-e6cb5a523ea2',NULL,NULL),
  ('B',2,'base_ref','记忆库租户隔离','green','39130340-16f0-47f1-9779-fc0b57218dd0',NULL,NULL),
  -- ===== GP-B S3 =====
  ('B',3,'capability','文字发送','green',NULL,NULL,NULL),
  ('B',3,'capability','图片发送','gray',NULL,NULL,NULL),
  ('B',3,'capability','链接发送','gray',NULL,NULL,NULL),
  ('B',3,'capability','文件/视频发送','gray',NULL,NULL,NULL),
  ('B',3,'element','FR','green',NULL,NULL,NULL),
  ('B',3,'element','NFR','green',NULL,NULL,NULL),
  ('B',3,'element','判定点','red',NULL,'eval:模糊承诺-得体判定,评测集待建',NULL),
  ('B',3,'element','两轴衔接','gray',NULL,NULL,'本步无两轴衔接'),
  ('B',3,'element','不变量','green',NULL,NULL,NULL),
  ('B',3,'element','失败语义','red',NULL,NULL,NULL),
  ('B',3,'element','死亡告警','red',NULL,NULL,NULL),
  ('B',3,'element','效果确认','red',NULL,NULL,NULL),
  ('B',3,'element','保质期','red',NULL,NULL,NULL),
  ('B',3,'scenario','日常','green',NULL,NULL,NULL),
  ('B',3,'scenario','断网排队重发','red',NULL,NULL,NULL),
  ('B',3,'scenario','微信升级后','red',NULL,NULL,NULL),
  ('B',3,'scenario','高峰频控','red',NULL,NULL,NULL),
  ('B',3,'base_ref','后台静默发送通道','green','2dde3bb5-2cb9-4c33-b592-224b1f4ffe41',NULL,NULL),
  ('B',3,'base_ref','记忆库租户隔离','green','39130340-16f0-47f1-9779-fc0b57218dd0',NULL,NULL),
  -- ===== GP-B S4 =====
  ('B',4,'capability','CRM 回填','pending',NULL,NULL,NULL),
  ('B',4,'capability','拉黑检测','gray',NULL,NULL,NULL),
  ('B',4,'capability','对话摘要入档','gray',NULL,NULL,NULL),
  ('B',4,'element','FR','pending',NULL,NULL,NULL),
  ('B',4,'element','NFR','red',NULL,NULL,NULL),
  ('B',4,'element','判定点','red',NULL,NULL,NULL),
  ('B',4,'element','两轴衔接','pending',NULL,NULL,NULL),
  ('B',4,'element','不变量','red',NULL,NULL,NULL),
  ('B',4,'element','失败语义','red',NULL,NULL,NULL),
  ('B',4,'element','死亡告警','red',NULL,NULL,NULL),
  ('B',4,'element','效果确认','red',NULL,NULL,NULL),
  ('B',4,'element','对抗面','red',NULL,NULL,NULL),
  ('B',4,'element','保质期','red',NULL,NULL,NULL),
  ('B',4,'element','账本保鲜','red',NULL,NULL,NULL),
  ('B',4,'scenario','全场景未验','red',NULL,NULL,NULL),
  ('B',4,'base_ref','CRM 表底座','pending','0b70f2ff-1a16-4029-a71a-e6cb5a523ea2',NULL,NULL),
  -- ===== GP-C =====
  ('C',1,'capability','文案生成','green',NULL,NULL,NULL),
  ('C',1,'capability','配图生成','gray',NULL,NULL,NULL),
  ('C',1,'element','判定点','pending',NULL,'待拍板：AI画图 vs 素材库选图',NULL),
  ('C',1,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL),
  ('C',2,'capability','纯文案发布','green',NULL,NULL,NULL),
  ('C',2,'capability','图文发布','gray',NULL,NULL,NULL),
  ('C',3,'capability','发布结果确认','red',NULL,NULL,NULL),
  ('C',3,'capability','发布台账','red',NULL,NULL,NULL),
  -- ===== GP-D =====
  ('D',1,'capability','CRM 表为唯一数据源','pending',NULL,NULL,NULL),
  ('D',1,'base_ref','CRM 表底座','pending','0b70f2ff-1a16-4029-a71a-e6cb5a523ea2',NULL,NULL),
  ('D',2,'capability','日报','pending',NULL,NULL,NULL),
  ('D',2,'capability','周报','gray',NULL,NULL,NULL),
  ('D',2,'capability','月报','gray',NULL,NULL,NULL),
  ('D',3,'capability','推送通道与送达确认','red',NULL,NULL,NULL),
  -- ===== GP-E =====
  ('E',1,'capability','动态采集','gray',NULL,NULL,NULL),
  ('E',1,'base_ref','消息/动态采集通道','gray','6691d09a-3525-4610-87d2-2d8261d68111',NULL,NULL),
  ('E',1,'base_ref','Agent 运行时底座','gray','0d4922c9-0a5e-4aa6-93ff-6e1911342622',NULL,NULL),
  ('E',1,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL),
  ('E',2,'element','判定点','green',NULL,'已拍板：语义判定点赞；评论 AI 出稿不自动发',NULL),
  ('E',3,'capability','点赞执行','gray',NULL,NULL,NULL),
  ('E',3,'capability','评论发布（人审后）','gray',NULL,NULL,NULL),
  ('E',3,'capability','回填 CRM 关系记录','red',NULL,NULL,NULL),
  ('E',3,'base_ref','后台静默发送通道','gray','2dde3bb5-2cb9-4c33-b592-224b1f4ffe41',NULL,NULL),
  ('E',3,'base_ref','CRM 表底座','gray','0b70f2ff-1a16-4029-a71a-e6cb5a523ea2',NULL,NULL),
  -- ===== GP-F =====
  ('F',1,'capability','群消息采集','gray',NULL,NULL,NULL),
  ('F',1,'element','判定点','green',NULL,'已拍板：默认全静默，只拉白关键群',NULL),
  ('F',1,'base_ref','消息/动态采集通道','gray','6691d09a-3525-4610-87d2-2d8261d68111',NULL,NULL),
  ('F',1,'base_ref','Agent 运行时底座','gray','0d4922c9-0a5e-4aa6-93ff-6e1911342622',NULL,NULL),
  ('F',1,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL),
  ('F',2,'capability','群内 AI 答','gray',NULL,NULL,NULL),
  ('F',2,'capability','群公告','gray',NULL,NULL,NULL),
  ('F',2,'capability','踢广告号','gray',NULL,NULL,NULL),
  ('F',2,'base_ref','后台静默发送通道','gray','2dde3bb5-2cb9-4c33-b592-224b1f4ffe41',NULL,NULL),
  ('F',3,'capability','群运营台账','red',NULL,NULL,NULL),
  -- ===== 首次成功 =====
  ('FS',2,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL)
)
INSERT INTO journey_step_links
  (journey_id, step_id, cell_kind, cell_key, cell_status, feature_id, assertion_ref, na_reason, status, notion_synced_at)
SELECT s.journey_id, s.id, cd.ckind, cd.ckey, cd.cstatus, cd.fid, cd.aref, cd.nar, 'planned', NOW()
FROM cell_data cd
JOIN gp ON gp.letter = cd.letter
JOIN journey_steps s ON s.journey_id = gp.jid AND s.step_number = cd.step_no
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO UPDATE SET
  cell_status = EXCLUDED.cell_status,
  feature_id  = EXCLUDED.feature_id,
  assertion_ref = EXCLUDED.assertion_ref,
  na_reason   = EXCLUDED.na_reason;
