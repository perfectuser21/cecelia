-- Migration 405: Rebuildable Universal Map projection runs, nodes, and edges.
-- Projection data is derived and may be deleted/rebuilt without mutating truth sources.

ALTER TABLE map_manifest_versions
  ADD CONSTRAINT map_manifest_projection_identity_unique
  UNIQUE (id, scope_key, digest);

CREATE TABLE IF NOT EXISTS map_projection_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key TEXT NOT NULL,
  manifest_version_id UUID NOT NULL,
  manifest_digest TEXT NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  fact_revisions JSONB NOT NULL CHECK (jsonb_typeof(fact_revisions) = 'object'),
  projector_version TEXT NOT NULL,
  projection_digest TEXT NOT NULL CHECK (projection_digest ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'active', 'superseded', 'failed')),
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  CONSTRAINT map_projection_run_activation_shape CHECK (
    (status IN ('active', 'superseded') AND activated_at IS NOT NULL)
    OR (status IN ('building', 'failed') AND activated_at IS NULL)
  ),
  CONSTRAINT map_projection_run_error_shape CHECK (
    (status = 'failed' AND error IS NOT NULL)
    OR (status <> 'failed' AND error IS NULL)
  ),
  CONSTRAINT map_projection_manifest_identity_fk
    FOREIGN KEY (manifest_version_id, scope_key, manifest_digest)
    REFERENCES map_manifest_versions (id, scope_key, digest)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_projection_one_active_per_scope
  ON map_projection_runs(scope_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_map_projection_scope_created
  ON map_projection_runs(scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_map_projection_manifest_version
  ON map_projection_runs(manifest_version_id);

CREATE TABLE IF NOT EXISTS map_projection_nodes (
  run_id UUID NOT NULL REFERENCES map_projection_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL CHECK (node_id ~ '^[0-9a-f]{64}$'),
  node_type TEXT NOT NULL CHECK (node_type IN (
    'value_stream', 'capability', 'crosscut', 'prerequisite',
    'backbone', 'feature', 'artifact', 'assertion'
  )),
  node_key TEXT NOT NULL,
  name TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_refs) = 'array'),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(attributes) = 'object'),
  PRIMARY KEY (run_id, node_id),
  CONSTRAINT map_projection_node_identity_unique UNIQUE (run_id, node_type, node_key)
);

CREATE INDEX IF NOT EXISTS idx_map_projection_nodes_lookup
  ON map_projection_nodes(node_type, node_key);

CREATE TABLE IF NOT EXISTS map_projection_edges (
  run_id UUID NOT NULL REFERENCES map_projection_runs(id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL CHECK (edge_id ~ '^[0-9a-f]{64}$'),
  edge_type TEXT NOT NULL CHECK (edge_type IN (
    'contains', 'hands_off_to', 'serves', 'requires', 'precedes',
    'implements', 'proves', 'affects', 'owned_by'
  )),
  edge_key TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_refs) = 'array'),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(attributes) = 'object'),
  PRIMARY KEY (run_id, edge_id),
  CONSTRAINT map_projection_edge_identity_unique UNIQUE (run_id, edge_type, edge_key),
  CONSTRAINT map_projection_edge_from_fk
    FOREIGN KEY (run_id, from_node_id)
    REFERENCES map_projection_nodes (run_id, node_id) ON DELETE CASCADE,
  CONSTRAINT map_projection_edge_to_fk
    FOREIGN KEY (run_id, to_node_id)
    REFERENCES map_projection_nodes (run_id, node_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_map_projection_edges_from
  ON map_projection_edges(run_id, from_node_id, edge_type);

CREATE INDEX IF NOT EXISTS idx_map_projection_edges_to
  ON map_projection_edges(run_id, to_node_id, edge_type);

INSERT INTO schema_version (version, description)
VALUES ('405', 'Rebuildable Universal Map projection core')
ON CONFLICT (version) DO NOTHING;
