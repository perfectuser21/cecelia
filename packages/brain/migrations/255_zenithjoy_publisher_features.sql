-- Migration 250: ZenithJoy 发布平台 & 内容生产 features
-- 补充各平台发布器、NAS、素材抓取的 feature 注册

INSERT INTO features (id, name, domain, priority, status, smoke_cmd) VALUES
  -- 平台发布器（8个平台）
  ('wechat-publisher',       '微信公众号发布',   'content', 'P1', 'active',
   'curl -sf http://localhost:5221/api/brain/publish-jobs?platform=wechat | jq -e ''.jobs != null'''),
  ('xiaohongshu-publisher',  '小红书发布',       'content', 'P1', 'active',
   'curl -sf http://localhost:5221/api/brain/publish-jobs?platform=xiaohongshu | jq -e ''.jobs != null'''),
  ('kuaishou-publisher',     '快手发布',         'content', 'P1', 'active',
   'curl -sf http://localhost:5221/api/brain/publish-jobs?platform=kuaishou | jq -e ''.jobs != null'''),
  ('douyin-publisher',       '抖音发布',         'content', 'P2', 'active',
   'curl -sf http://localhost:5221/api/brain/publish-jobs?platform=douyin | jq -e ''.jobs != null'''),
  ('shipinhao-publisher',    '视频号发布',       'content', 'P1', 'active',
   'curl -sf http://localhost:5221/api/brain/publish-jobs?platform=shipinhao | jq -e ''.jobs != null'''),
  ('weibo-publisher',        '微博发布',         'content', 'P2', 'active',
   'curl -sf http://localhost:5221/api/brain/publish-jobs?platform=weibo | jq -e ''.jobs != null'''),
  ('toutiao-publisher',      '头条发布',         'content', 'P2', 'active',
   'curl -sf http://localhost:5221/api/brain/publish-jobs?platform=toutiao | jq -e ''.jobs != null'''),
  ('zhihu-publisher',        '知乎发布',         'content', 'P3', 'active',
   'curl -sf http://localhost:5221/api/brain/publish-jobs?platform=zhihu | jq -e ''.jobs != null'''),

  -- 图文生产辅助
  ('image-text-publisher',   '图文多平台分发',   'content', 'P1', 'active',
   'curl -sf http://localhost:5221/api/brain/publish-jobs | jq -e ''.jobs != null'''),

  -- 素材采集
  ('media-scraping',         '媒体素材抓取',     'content', 'P2', 'active',
   'curl -sf http://localhost:5221/api/brain/pipelines | jq -e ''type == "array"'''),
  ('platform-scraper',       '平台内容抓取',     'content', 'P2', 'active',
   'curl -sf http://localhost:5221/api/brain/social/trending | jq -e ''type == "array"'''),

  -- NAS 备份
  ('nas-backup',             'NAS 自动备份',     'operation', 'P2', 'active',
   'curl -sf http://localhost:5221/api/brain/health | jq -e ''.status == "healthy"''')

ON CONFLICT (id) DO NOTHING;
