-- Migration 100: Brain Architecture DB Configuration
-- brain_nodes and brain_connections tables for DB-driven architecture config

CREATE TABLE IF NOT EXISTS brain_nodes (
  id          VARCHAR(64)  PRIMARY KEY,
  block_id    VARCHAR(64)  NOT NULL,
  label       VARCHAR(128) NOT NULL,
  nature      VARCHAR(32)  NOT NULL DEFAULT 'dynamic'
                           CHECK (nature IN ('dynamic', 'growing', 'fixed')),
  pos_x       INTEGER      NOT NULL DEFAULT 0,
  pos_y       INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_connections (
  id          SERIAL       PRIMARY KEY,
  from_node   VARCHAR(64)  NOT NULL REFERENCES brain_nodes(id) ON DELETE CASCADE,
  to_node     VARCHAR(64)  NOT NULL REFERENCES brain_nodes(id) ON DELETE CASCADE,
  path_type   VARCHAR(8)   NOT NULL DEFAULT 'A'
                           CHECK (path_type IN ('A', 'B', 'C', 'D')),
  is_broken   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(from_node, to_node)
);

-- Seed: 15 nodes
INSERT INTO brain_nodes (id, block_id, label, nature, pos_x, pos_y) VALUES
  ('tick',               'interface',  'Tick 心跳',     'dynamic', 60,  120),
  ('dialog',             'interface',  '对话系统',       'dynamic', 60,  320),
  ('thalamus',           'core',       '丘脑 L1',        'dynamic', 250, 120),
  ('emotion',            'perception', '情绪层',          'dynamic', 250, 320),
  ('cortex',             'core',       '皮层 L2',         'dynamic', 440, 80),
  ('cognitive',          'core',       '认知核心',         'dynamic', 440, 220),
  ('desire',             'core',       '欲望系统',         'growing', 440, 360),
  ('memory',             'evolution',  '记忆系统',         'growing', 630, 80),
  ('rumination',         'core',       '反刍',             'growing', 630, 200),
  ('learning',           'evolution',  '学习',             'growing', 630, 320),
  ('self_model',         'evolution',  '自我模型',          'growing', 630, 440),
  ('planner',            'action',     '调度规划',          'dynamic', 820, 80),
  ('executor',           'action',     '执行器',            'dynamic', 820, 200),
  ('suggestion',         'action',     '建议系统',           'dynamic', 820, 340),
  ('immune',             'action',     '免疫系统',           'dynamic', 820, 460)
ON CONFLICT (id) DO NOTHING;

-- Seed: 21 connections
INSERT INTO brain_connections (from_node, to_node, path_type, is_broken) VALUES
  -- A: 自主循环 (蓝)
  ('tick',        'thalamus',  'A', FALSE),
  ('thalamus',    'cortex',    'A', FALSE),
  ('cortex',      'memory',    'A', FALSE),
  ('cortex',      'learning',  'A', FALSE),
  ('planner',     'executor',  'A', FALSE),
  ('tick',        'planner',   'A', FALSE),
  ('tick',        'cognitive', 'A', FALSE),
  -- B: 对话驱动 (紫)
  ('dialog',      'thalamus',  'B', FALSE),
  ('dialog',      'memory',    'B', FALSE),
  ('thalamus',    'emotion',   'B', FALSE),
  ('emotion',     'desire',    'B', FALSE),
  ('desire',      'suggestion','B', FALSE),
  ('desire',      'executor',  'B', FALSE),
  ('suggestion',  'planner',   'B', TRUE),   -- P0 断路
  -- C: 学习回路 (黄)
  ('memory',      'rumination','C', FALSE),
  ('rumination',  'learning',  'C', FALSE),
  ('learning',    'self_model','C', FALSE),
  ('self_model',  'cognitive', 'C', FALSE),
  ('cognitive',   'emotion',   'C', FALSE),
  -- D: 防护回路 (红)
  ('executor',    'immune',    'D', FALSE),
  ('immune',      'planner',   'D', FALSE)
ON CONFLICT (from_node, to_node) DO NOTHING;
