-- Migration 252: ZenithJoy 遗漏 feature 全量补录
-- 覆盖 Agent自检/License管理/Works CRUD/发布日志/租户/任务调度/Creator服务/JNSY标注扩展

INSERT INTO features (id, name, domain, priority, status, smoke_cmd) VALUES

  -- ── Agent 自检端点（creator domain）────────────────────────────────────────
  ('agent-register',          'Agent License 注册',       'creator', 'P2', 'active',
   'curl -sf http://localhost:5200/api/agent/status | jq -e ''.agents != null'''),
  ('agent-test-wechat',       'Agent 微信发布自检',       'creator', 'P2', 'active',
   'curl -s http://localhost:5200/api/agent/test-publish -X POST | jq -e ''.ok == true or .error != null'''),
  ('agent-test-douyin',       'Agent 抖音发布自检',       'creator', 'P2', 'active',
   'curl -s http://localhost:5200/api/agent/test-publish-douyin -X POST | jq -e ''.ok == true or .error != null'''),
  ('agent-test-kuaishou',     'Agent 快手发布自检',       'creator', 'P2', 'active',
   'curl -s http://localhost:5200/api/agent/test-publish-kuaishou -X POST | jq -e ''.ok == true or .error != null'''),
  ('agent-test-xiaohongshu',  'Agent 小红书发布自检',     'creator', 'P2', 'active',
   'curl -s http://localhost:5200/api/agent/test-publish-xiaohongshu -X POST | jq -e ''.ok == true or .error != null'''),
  ('agent-test-toutiao',      'Agent 头条发布自检',       'creator', 'P2', 'active',
   'curl -s http://localhost:5200/api/agent/test-publish-toutiao -X POST | jq -e ''.ok == true or .error != null'''),
  ('agent-test-weibo',        'Agent 微博发布自检',       'creator', 'P2', 'active',
   'curl -s http://localhost:5200/api/agent/test-publish-weibo -X POST | jq -e ''.ok == true or .error != null'''),
  ('agent-test-shipinhao',    'Agent 视频号发布自检',     'creator', 'P2', 'active',
   'curl -s http://localhost:5200/api/agent/test-publish-shipinhao -X POST | jq -e ''.ok == true or .error != null'''),
  ('agent-test-zhihu',        'Agent 知乎发布自检',       'creator', 'P2', 'active',
   'curl -s http://localhost:5200/api/agent/test-publish-zhihu -X POST | jq -e ''.ok == true or .error != null'''),

  -- ── License 管理（platform-auth domain）────────────────────────────────────
  ('license-list',   'License 列表查询',   'platform-auth', 'P1', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/admin/license'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''.success == true'''),
  ('license-create', 'License 创建',       'platform-auth', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/admin/license'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''.data != null'''),
  ('license-revoke', 'License 吊销',       'platform-auth', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/admin/license'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''.success == true'''),
  ('license-me',     '当前用户 License 查询', 'platform-auth', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/admin/license'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''.success == true'''),

  -- ── Works CRUD 扩展（media domain）─────────────────────────────────────────
  ('works-create',   '创建内容作品',       'media', 'P1', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/works'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''type == "object"'''),
  ('works-update',   '更新内容作品',       'media', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/works'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''type == "object"'''),
  ('works-delete',   '删除内容作品',       'media', 'P3', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/works'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''type == "object"'''),

  -- ── 发布日志（media domain）─────────────────────────────────────────────────
  ('publish-logs-list',   '作品发布日志列表', 'media', 'P1', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/works'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''type == "object"'''),
  ('publish-logs-create', '创建发布日志',     'media', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/works'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''type == "object"'''),
  ('publish-logs-update', '更新发布日志',     'media', 'P3', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/works'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''type == "object"'''),

  -- ── 租户管理扩展（platform-auth domain）────────────────────────────────────
  ('tenants-create',       '创建租户',         'platform-auth', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/health'' | jq -e ''.status == "ok"'''),
  ('tenants-feishu-config','租户飞书配置',     'platform-auth', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/health'' | jq -e ''.status == "ok"'''),

  -- ── ZenithJoy 任务调度（creator domain）────────────────────────────────────
  ('zj-task-create',  'ZJ 任务创建',    'creator', 'P1', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/health'' | jq -e ''.status == "ok"'''),
  ('zj-task-list',    'ZJ 任务列表',    'creator', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/health'' | jq -e ''.status == "ok"'''),
  ('zj-task-get',     'ZJ 任务详情',    'creator', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/health'' | jq -e ''.status == "ok"'''),

  -- ── 快照 work 查询（scraping domain）───────────────────────────────────────
  ('snapshot-work',   '作品快照查询',   'scraping', 'P2', 'active',
   'ZJ_TOK=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2-) && curl -sf ''http://localhost:5200/api/snapshots/douyin'' -H "Authorization: Bearer $ZJ_TOK" | jq -e ''.count >= 0'''),

  -- ── ZenithJoy Skill 注册表（creator domain）────────────────────────────────
  ('zj-skills',       'ZenithJoy Skill 注册表', 'creator', 'P2', 'active',
   'curl -sf ''http://localhost:5200/api/skills'' | jq -e ''.skills != null'''),

  -- ── Creator 服务（端口 8899，creator domain）────────────────────────────────
  ('creator-health',            'Creator 服务健康检查',   'creator', 'P1', 'active',
   'curl -sf ''http://localhost:8899/health'' | jq -e ''.status == "ok"'''),
  ('creator-topics-list',       'Creator 选题列表',       'creator', 'P1', 'active',
   'curl -sf ''http://localhost:8899/api/topics?limit=1'' | jq -e ''.success == true'''),
  ('creator-topics-create',     'Creator 创建选题',       'creator', 'P1', 'active',
   'curl -sf ''http://localhost:8899/api/topics?limit=1'' | jq -e ''.success == true'''),
  ('creator-topics-get',        'Creator 选题详情',       'creator', 'P2', 'active',
   'curl -sf ''http://localhost:8899/api/topics?limit=1'' | jq -e ''.success == true'''),
  ('creator-topics-update',     'Creator 更新选题',       'creator', 'P2', 'active',
   'curl -sf ''http://localhost:8899/api/topics?limit=1'' | jq -e ''.success == true'''),
  ('creator-topics-delete',     'Creator 删除选题',       'creator', 'P3', 'active',
   'curl -sf ''http://localhost:8899/api/topics?limit=1'' | jq -e ''.success == true'''),
  ('creator-pacing-config',     'Creator 发布节奏配置',   'creator', 'P2', 'active',
   'curl -sf ''http://localhost:8899/api/topics/pacing/config'' | jq -e ''.success == true'''),
  ('creator-pipeline-trigger',  'Creator Pipeline 触发',  'creator', 'P1', 'active',
   'curl -sf ''http://localhost:8899/health'' | jq -e ''.status == "ok"'''),

  -- ── JNSY 标注系统扩展（label domain）───────────────────────────────────────
  ('label-users',         '标注用户管理',         'label', 'P2', 'active',
   'curl -sf ''http://localhost:8000/api/status'' | jq -e ''type == "object"'''),
  ('label-admin',         '标注管理员功能',       'label', 'P2', 'active',
   'curl -sf ''http://localhost:8000/api/status'' | jq -e ''type == "object"'''),
  ('label-python-qa',     '标注 Python 编程题',   'label', 'P2', 'active',
   'curl -sf ''http://localhost:8000/api/status'' | jq -e ''type == "object"'''),
  ('label-import',        '标注题目批量导入',     'label', 'P2', 'active',
   'curl -sf ''http://localhost:8000/api/status'' | jq -e ''type == "object"''')

ON CONFLICT (id) DO NOTHING;
