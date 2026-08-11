BEGIN;

DROP TABLE IF EXISTS graph_edge_snapshots;
DROP TABLE IF EXISTS graph_snapshot_versions;

DELETE FROM schema_version WHERE version = '410';

COMMIT;
