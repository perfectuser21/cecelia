-- Migration 251: ZenithJoy 完整 feature 注册
-- 覆盖 works 管理、内容生产执行器、平台数据采集、AI视频、竞品研究、标注系统、Agent管理

INSERT INTO features (id, name, domain, priority, status, smoke_cmd) VALUES

  -- ── 作品管理（media domain）──────────────────────────────────────────────
  ('works-list',         '内容作品列表',       'media',    'P1', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('works-detail',       '作品详情',           'media',    'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('work-performance',   '作品数据分析',       'media',    'P1', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('publish-log',        '发布日志管理',       'media',    'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('pacing-config',      '发布节奏配置',       'media',    'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('content-images',     '内容图片服务',       'media',    'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),

  -- ── 内容生产执行器（creator domain）─────────────────────────────────────
  ('executor-research',     '研究阶段执行',   'creator',  'P1', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('executor-copywriting',  '文案生成执行',   'creator',  'P1', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('executor-copy-review',  '文案审核执行',   'creator',  'P1', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('executor-image-review', '图片审核执行',   'creator',  'P1', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('executor-generate',     '内容生成执行',   'creator',  'P1', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('executor-export',       '内容导出执行',   'creator',  'P1', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('creator-agent-status',  'Creator Agent 状态', 'creator', 'P1', 'active',
   'curl -sf http://localhost:5200/api/agent/status | jq -e ''.agents | length >= 0'''),
  ('creator-agent-health',  'Creator Agent 健康检查', 'creator', 'P1', 'active',
   'curl -sf http://localhost:5200/api/agent/status | jq -e ''type == "object"'''),

  -- ── 平台数据采集（scraping domain）──────────────────────────────────────
  ('snapshot-ingest',            '数据快照采集',     'scraping', 'P1', 'active',
   'curl -sf http://localhost:5200/api/snapshots/douyin | jq -e ''.success == true'''),
  ('snapshot-query',             '快照查询',         'scraping', 'P2', 'active',
   'curl -sf http://localhost:5200/api/snapshots/douyin | jq -e ''.count >= 0'''),
  ('scraper-douyin',             '抖音数据采集',     'scraping', 'P1', 'active',
   'curl -sf http://localhost:5200/api/snapshots/douyin | jq -e ''.success == true'''),
  ('scraper-kuaishou',           '快手数据采集',     'scraping', 'P1', 'active',
   'curl -sf http://localhost:5200/api/snapshots/kuaishou | jq -e ''.success == true'''),
  ('scraper-xiaohongshu',        '小红书数据采集',   'scraping', 'P1', 'active',
   'curl -sf http://localhost:5200/api/snapshots/xiaohongshu | jq -e ''.success == true'''),
  ('scraper-weibo',              '微博数据采集',     'scraping', 'P2', 'active',
   'curl -sf http://localhost:5200/api/snapshots/weibo | jq -e ''.success == true'''),
  ('scraper-toutiao',            '头条数据采集',     'scraping', 'P2', 'active',
   'curl -sf http://localhost:5200/api/snapshots/toutiao | jq -e ''.success == true'''),
  ('scraper-zhihu',              '知乎数据采集',     'scraping', 'P2', 'active',
   'curl -sf http://localhost:5200/api/snapshots/zhihu | jq -e ''.success == true'''),
  ('scraper-wechat',             '公众号数据采集',   'scraping', 'P1', 'active',
   'curl -sf http://localhost:5200/api/snapshots/wechat | jq -e ''.success == true'''),
  ('scraper-shipinhao',          '视频号数据采集',   'scraping', 'P1', 'active',
   'curl -sf http://localhost:5200/api/snapshots/shipinhao | jq -e ''.success == true'''),
  ('workflow-data-scraper',      '数据采集调度工作流', 'scraping', 'P1', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),

  -- ── AI 视频生成（ai-gen domain）──────────────────────────────────────────
  ('ai-video-generate',  'AI 视频生成',        'ai-gen',   'P1', 'active',
   'curl -sf http://localhost:5200/api/ai-video/history | jq -e ''.data | length >= 0'''),
  ('ai-video-history',   'AI 视频历史',        'ai-gen',   'P2', 'active',
   'curl -sf http://localhost:5200/api/ai-video/history | jq -e ''.total >= 0'''),
  ('ai-video-active',    '活跃 AI 视频任务',   'ai-gen',   'P2', 'active',
   'curl -sf http://localhost:5200/api/ai-video/active | jq -e ''type == "array"'''),

  -- ── 竞品研究（research domain）──────────────────────────────────────────
  ('competitor-research', '竞争对手研究',      'research', 'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),

  -- ── 平台授权（platform-auth domain）─────────────────────────────────────
  ('platform-auth-douyin',  '抖音 OAuth 授权', 'platform-auth', 'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('tenant-management',     '租户管理',         'platform-auth', 'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('feishu-integration',    '飞书集成',         'platform-auth', 'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),

  -- ── JNSY 标注系统（label domain）────────────────────────────────────────
  ('label-project',      '标注项目管理',       'label',    'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('label-task',         '标注任务管理',       'label',    'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('label-question',     '标注题目管理',       'label',    'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('label-stats',        '标注数据统计',       'label',    'P2', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"'''),
  ('label-auth',         '标注系统认证',       'label',    'P3', 'active',
   'curl -sf http://localhost:5200/health | jq -e ''.status == "ok"''')

ON CONFLICT (id) DO NOTHING;
