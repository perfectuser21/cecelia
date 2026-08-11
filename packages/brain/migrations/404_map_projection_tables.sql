-- Migration 404: Reserved schema floor marker.
-- Projection tables (map_projection_runs / map_projection_nodes / map_projection_edges)
-- are created by migration 405 (map_projection_core) with the authoritative schema.
-- This entry exists solely to hold the schema_version floor at 404 during the brief
-- window between PR #4786 (刀0-4 fact pipeline) and PR #4790 (刀2 projection core).

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '404',
  '刀2 map projection schema floor marker (tables created by migration 405)',
  NOW()
)
ON CONFLICT (version) DO NOTHING;
