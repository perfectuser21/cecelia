-- packages/brain/migrations/351_graph_edges.sql
-- 刀A1:总关系图进照相层(import/spawn/http 三类边,scan-graph 每日全量重拍)
-- spec: docs/superpowers/specs/2026-07-18-graph-photo-layer-design.md
CREATE TABLE IF NOT EXISTS graph_edges (
  id bigserial PRIMARY KEY,
  repo varchar(100) NOT NULL DEFAULT 'cecelia',
  src_path text NOT NULL,
  dst_path text NOT NULL,
  edge_type varchar(20) NOT NULL CHECK (edge_type IN ('import', 'spawn', 'http')),
  detail jsonb NOT NULL DEFAULT '{}',
  scanned_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_src ON graph_edges(repo, src_path);
CREATE INDEX IF NOT EXISTS idx_graph_edges_dst ON graph_edges(repo, dst_path);
CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type);
