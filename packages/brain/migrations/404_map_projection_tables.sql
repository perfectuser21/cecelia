-- Migration 399: 刀2 — Rebuildable Projection Pool
-- PRD: Universal Map Projection Engine, Knife 2
-- 三张可重建派生表：runs / nodes / edges

-- 1. map_projection_runs: 每次投影运行记录
CREATE TABLE IF NOT EXISTS map_projection_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key        TEXT        NOT NULL CHECK (btrim(scope_key) <> ''),
  manifest_id      UUID        REFERENCES map_manifest_versions(id) ON DELETE RESTRICT,
  manifest_digest  TEXT        NOT NULL,
  fact_revisions   JSONB       NOT NULL DEFAULT '{}',
  projector_version TEXT       NOT NULL DEFAULT '1.0.0',
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'success', 'failed')),
  projection_digest TEXT,
  error            TEXT,
  node_count       INTEGER     NOT NULL DEFAULT 0,
  edge_count       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  is_active        BOOLEAN     NOT NULL DEFAULT false
);

-- 同一 scope_key 最多一份 active run
CREATE UNIQUE INDEX IF NOT EXISTS idx_map_projection_runs_active_scope
  ON map_projection_runs (scope_key)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_map_projection_runs_scope   ON map_projection_runs (scope_key);
CREATE INDEX IF NOT EXISTS idx_map_projection_runs_status  ON map_projection_runs (status);
CREATE INDEX IF NOT EXISTS idx_map_projection_runs_manifest ON map_projection_runs (manifest_id);

-- 2. map_projection_nodes: 投影节点
CREATE TABLE IF NOT EXISTS map_projection_nodes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID        NOT NULL REFERENCES map_projection_runs(id) ON DELETE CASCADE,
  scope_key        TEXT        NOT NULL,
  node_key         TEXT        NOT NULL CHECK (btrim(node_key) <> ''),
  node_type        TEXT        NOT NULL
                   CHECK (node_type IN (
                     'value_stream', 'capability', 'crosscut', 'prerequisite',
                     'backbone', 'feature', 'artifact', 'assertion'
                   )),
  name             TEXT        NOT NULL,
  attributes       JSONB       NOT NULL DEFAULT '{}',
  source_refs      JSONB       NOT NULL DEFAULT '[]',
  aliases          TEXT[]      NOT NULL DEFAULT '{}',
  display_order    INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, node_key)
);

CREATE INDEX IF NOT EXISTS idx_map_projection_nodes_run     ON map_projection_nodes (run_id);
CREATE INDEX IF NOT EXISTS idx_map_projection_nodes_type    ON map_projection_nodes (run_id, node_type);
CREATE INDEX IF NOT EXISTS idx_map_projection_nodes_key     ON map_projection_nodes (scope_key, node_key);

-- 3. map_projection_edges: 投影边
CREATE TABLE IF NOT EXISTS map_projection_edges (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID        NOT NULL REFERENCES map_projection_runs(id) ON DELETE CASCADE,
  scope_key        TEXT        NOT NULL,
  edge_key         TEXT,
  from_key         TEXT        NOT NULL,
  to_key           TEXT        NOT NULL,
  edge_type        TEXT        NOT NULL
                   CHECK (edge_type IN (
                     'contains', 'hands_off_to', 'serves', 'requires',
                     'precedes', 'implements', 'proves', 'affects', 'owned_by'
                   )),
  attributes       JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_map_projection_edges_run     ON map_projection_edges (run_id);
CREATE INDEX IF NOT EXISTS idx_map_projection_edges_from    ON map_projection_edges (run_id, from_key);
CREATE INDEX IF NOT EXISTS idx_map_projection_edges_to      ON map_projection_edges (run_id, to_key);
CREATE INDEX IF NOT EXISTS idx_map_projection_edges_type    ON map_projection_edges (run_id, edge_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_map_projection_edges_unique
  ON map_projection_edges (run_id, COALESCE(edge_key, from_key || '_' || to_key || '_' || edge_type));

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '404',
  '刀2: map_projection_runs / map_projection_nodes / map_projection_edges 可重建投影池',
  NOW()
)
ON CONFLICT (version) DO NOTHING;
