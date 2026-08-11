DROP TABLE IF EXISTS map_projection_edges;
DROP TABLE IF EXISTS map_projection_nodes;
DROP TABLE IF EXISTS map_projection_runs;
ALTER TABLE map_manifest_versions
  DROP CONSTRAINT IF EXISTS map_manifest_projection_identity_unique;
DELETE FROM schema_version WHERE version = '405';
