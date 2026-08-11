DROP TRIGGER IF EXISTS map_manifest_content_immutable ON map_manifest_versions;
DROP FUNCTION IF EXISTS reject_map_manifest_content_update();
DROP TABLE IF EXISTS map_manifest_versions;
DELETE FROM schema_version WHERE version = '402';
