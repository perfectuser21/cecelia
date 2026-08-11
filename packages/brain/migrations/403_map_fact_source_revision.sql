-- Migration 397: 刀0 — 事实池 source_revision + scanner_version 字段补齐
-- PRD: Universal Map Projection Engine, Knife 0
-- 每个 snapshot 必须携带 repo、source_revision、scanned_at、scanner version
-- 现有表缺字段时以 additive migration 补齐；禁止从文件 mtime 猜 revision。

-- graph_edges: 补 source_revision / scanner_version
ALTER TABLE graph_edges
  ADD COLUMN IF NOT EXISTS source_revision TEXT,
  ADD COLUMN IF NOT EXISTS scanner_version TEXT;

-- api_registry: 补 source_revision / scanner_version / repo
ALTER TABLE api_registry
  ADD COLUMN IF NOT EXISTS source_revision TEXT,
  ADD COLUMN IF NOT EXISTS scanner_version TEXT,
  ADD COLUMN IF NOT EXISTS repo TEXT NOT NULL DEFAULT 'cecelia';

-- db_schema_registry: 补 source_revision / scanner_version / repo
ALTER TABLE db_schema_registry
  ADD COLUMN IF NOT EXISTS source_revision TEXT,
  ADD COLUMN IF NOT EXISTS scanner_version TEXT,
  ADD COLUMN IF NOT EXISTS repo TEXT NOT NULL DEFAULT 'cecelia';

-- test_registry: 补 source_revision / scanner_version / repo
ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS source_revision TEXT,
  ADD COLUMN IF NOT EXISTS scanner_version TEXT,
  ADD COLUMN IF NOT EXISTS repo TEXT NOT NULL DEFAULT 'cecelia';

-- 索引
CREATE INDEX IF NOT EXISTS idx_graph_edges_revision     ON graph_edges (repo, source_revision);
CREATE INDEX IF NOT EXISTS idx_api_registry_revision    ON api_registry (repo, source_revision);
CREATE INDEX IF NOT EXISTS idx_test_registry_revision   ON test_registry (repo, source_revision);

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '403',
  '刀0: 事实池 source_revision + scanner_version + repo 字段补齐',
  NOW()
)
ON CONFLICT (version) DO NOTHING;
