-- Immutable, revision-indexed graph snapshots for long-running Impact Contracts.

BEGIN;

CREATE TABLE IF NOT EXISTS graph_snapshot_versions (
  repo VARCHAR(100) NOT NULL,
  source_revision TEXT NOT NULL,
  scanner_version VARCHAR(100) NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  PRIMARY KEY (repo, source_revision)
);

CREATE TABLE IF NOT EXISTS graph_edge_snapshots (
  repo VARCHAR(100) NOT NULL,
  source_revision TEXT NOT NULL,
  src_path TEXT NOT NULL,
  dst_path TEXT NOT NULL,
  edge_type VARCHAR(20) NOT NULL CHECK (edge_type IN ('import', 'spawn', 'http')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (repo, source_revision, src_path, dst_path, edge_type),
  FOREIGN KEY (repo, source_revision)
    REFERENCES graph_snapshot_versions(repo, source_revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_graph_edge_snapshots_src
  ON graph_edge_snapshots(repo, source_revision, src_path);
CREATE INDEX IF NOT EXISTS idx_graph_edge_snapshots_dst
  ON graph_edge_snapshots(repo, source_revision, dst_path);

INSERT INTO graph_snapshot_versions
  (repo, source_revision, scanner_version, scanned_at, row_count)
SELECT header.repo, header.source_revision, header.scanner_version,
       header.scanned_at, header.row_count
  FROM fact_snapshot_headers AS header
 WHERE header.kind = 'graph'
ON CONFLICT (repo, source_revision) DO NOTHING;

INSERT INTO graph_edge_snapshots
  (repo, source_revision, src_path, dst_path, edge_type, detail)
SELECT edge.repo, edge.source_revision, edge.src_path, edge.dst_path,
       edge.edge_type, edge.detail
  FROM graph_edges AS edge
  JOIN graph_snapshot_versions AS version
    ON version.repo = edge.repo
   AND version.source_revision = edge.source_revision
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('408', 'Immutable revision-indexed graph snapshots', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
