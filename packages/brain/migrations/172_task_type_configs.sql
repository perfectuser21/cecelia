-- Migration 172: 动态任务类型路由配置表
-- 存储「其余 Codex B类」任务的路由参数（location/executor/skill），供 Brain 动态读取
-- A类和 Coding pathway B类保持 hardcoded，不在此表中

CREATE TABLE IF NOT EXISTS task_type_configs (
  task_type   VARCHAR(100) PRIMARY KEY,
  location    VARCHAR(10)  NOT NULL DEFAULT 'xian',  -- 'us' | 'hk' | 'xian'
  executor    VARCHAR(50)  NOT NULL DEFAULT 'codex_bridge', -- 'cecelia_run' | 'codex_review' | 'codex_bridge' | 'minimax'
  skill       VARCHAR(100),                           -- e.g. '/strategy-session', '/decomp'
  description TEXT,
  is_dynamic  BOOLEAN      NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 种入初始动态 B类任务类型（纯策略/知识类，不需要读代码）
INSERT INTO task_type_configs (task_type, location, executor, skill, description) VALUES
  ('strategy_session', 'xian', 'codex_bridge', '/strategy-session', '战略会议 — B類纯策略，不需读代码'),
  ('suggestion_plan',  'xian', 'codex_bridge', '/plan',             'Suggestion 层级识别 — B類纯策略'),
  ('knowledge',        'xian', 'codex_bridge', '/knowledge',        '知识记录 — B類，/knowledge skill'),
  ('scope_plan',       'xian', 'codex_bridge', '/decomp',           'Scope 规划 — B類，/decomp skill'),
  ('project_plan',     'xian', 'codex_bridge', '/decomp',           'Project 规划 — B類，/decomp skill')
ON CONFLICT (task_type) DO NOTHING;

INSERT INTO schema_version (version, description) VALUES ('172', 'task_type_configs') ON CONFLICT DO NOTHING;
