-- Migration 490: phone_registry 手机台账（任务 b923b1f7，决策 432172f7 方案 C）
--
-- 0929 事故：秋米任务写「小黄手机」「小彩手机（型号 MAA-AN00）」，agent 在执行机 tsv 里查不到昵称，
-- 卡住或用错手机、写错数据。昵称/别名/技术名/抖音号 → 手机 的映射是台账数据，落这张表；
-- 路由（routing/phone-resolver.js）只查表 + 核验 + 查不到退回，代码里不写任何一台手机。
-- 维护入口：PUT /api/brain/phone-registry/:serial（内部令牌）。
-- 种子 = 2026-09-29 实测四台；ON CONFLICT DO NOTHING——台账里后改的值不被重跑迁移冲掉。

CREATE TABLE IF NOT EXISTS phone_registry (
  serial text PRIMARY KEY,
  nickname text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  host text,
  profile text,
  model text,
  owner text,
  role text,
  douyin_accounts jsonb NOT NULL DEFAULT '[]',
  wechat jsonb,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  updated_by text
);

COMMENT ON TABLE phone_registry IS
  '手机台账（决策 432172f7）：昵称/别名/技术名(profile)/抖音号 → 手机 的唯一真身；秋米路由唯一命中才派，定不下转 blocked(device_unresolved)。';
COMMENT ON COLUMN phone_registry.douyin_accounts IS
  '[{id: 抖音号|null, nickname: 抖音昵称, current: 当前登录}]，最多一个 current=true';
COMMENT ON COLUMN phone_registry.wechat IS '{id: 微信号, nickname: 微信昵称}；未登录为 NULL';

INSERT INTO phone_registry (serial, nickname, aliases, host, profile, model, owner, role, douyin_accounts, wechat, updated_by) VALUES
('ANGYVB4311010223', '小彩', ARRAY['三号机', '小龙虾'], 'xian-m1', 'xiaolongxia', 'MAA-AN00', '悦升云端', '研发',
  '[{"id": "90915521618", "nickname": "Ai办公室", "current": true}, {"id": null, "nickname": "秦军餐饮", "current": false}]'::jsonb,
  '{"id": "AI-MrXu", "nickname": "徐老师企业Ai方案落地师"}'::jsonb, 'migration-490'),
('e6c7ef34', '小白', ARRAY['二号机'], 'xian-m1', 'yueshengyun-work', 'RMX3478', '悦升云端', '生产',
  '[{"id": "37358506855", "nickname": "Ai效率笔记", "current": true}, {"id": null, "nickname": "大湖成长之路（Ai+）", "current": false}]'::jsonb,
  '{"id": "zenithjoyai", "nickname": "大湖-企业AI方案"}'::jsonb, 'migration-490'),
('ANGYVB4402004137', '小黄', ARRAY['一号机'], 'xian-m4', 'legacy', 'MAA-AN00', '金诺盛源', '研发',
  '[{"id": "44997267357", "nickname": "人工智能小诺考评", "current": true}]'::jsonb,
  '{"id": "wxid_fts6libbfcje22", "nickname": "5026"}'::jsonb, 'migration-490'),
('ANGYVB4227006983', '小蓝', ARRAY['四号机', '金诺机'], 'xian-m4', 'jinoshengyuan-work', 'MAA-AN00', '金诺盛源', '生产',
  '[{"id": "langzi63485", "nickname": "躺赢AI学姐", "current": true}]'::jsonb,
  NULL, 'migration-490')
ON CONFLICT (serial) DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('490', 'phone_registry 手机台账：昵称/别名/profile/抖音号 → 手机，秋米路由唯一命中才派；种子 0929 实测四台')
ON CONFLICT (version) DO NOTHING;
