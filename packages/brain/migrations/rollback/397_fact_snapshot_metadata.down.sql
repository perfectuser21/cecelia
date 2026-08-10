-- Rollback 397 is intentionally fail-safe: the old global unique keys cannot
-- represent the same natural key in more than one repo.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM api_registry GROUP BY method, path HAVING COUNT(DISTINCT repo) > 1
  ) THEN
    RAISE EXCEPTION 'cannot rollback 397: api_registry contains cross-repo natural-key conflicts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM db_schema_registry GROUP BY table_name HAVING COUNT(DISTINCT repo) > 1
  ) THEN
    RAISE EXCEPTION 'cannot rollback 397: db_schema_registry contains cross-repo natural-key conflicts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM test_registry GROUP BY file_path HAVING COUNT(DISTINCT repo) > 1
  ) THEN
    RAISE EXCEPTION 'cannot rollback 397: test_registry contains cross-repo natural-key conflicts';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_api_registry_repo_scanned_at;
DROP INDEX IF EXISTS idx_db_schema_registry_repo_scanned_at;
DROP INDEX IF EXISTS idx_test_registry_repo_scanned_at;
DROP INDEX IF EXISTS idx_graph_edges_repo_scanned_at;

ALTER TABLE api_registry DROP CONSTRAINT IF EXISTS api_registry_repo_method_path_key;
ALTER TABLE api_registry ADD CONSTRAINT api_registry_method_path_key UNIQUE (method, path);

ALTER TABLE db_schema_registry DROP CONSTRAINT IF EXISTS db_schema_registry_repo_table_name_key;
ALTER TABLE db_schema_registry ADD CONSTRAINT db_schema_registry_table_name_key UNIQUE (table_name);

ALTER TABLE test_registry DROP CONSTRAINT IF EXISTS test_registry_repo_file_path_key;
ALTER TABLE test_registry ADD CONSTRAINT test_registry_file_path_key UNIQUE (file_path);

ALTER TABLE api_registry
  DROP COLUMN IF EXISTS source_revision,
  DROP COLUMN IF EXISTS scanner_version,
  DROP COLUMN IF EXISTS repo;
ALTER TABLE db_schema_registry
  DROP COLUMN IF EXISTS source_revision,
  DROP COLUMN IF EXISTS scanner_version,
  DROP COLUMN IF EXISTS repo;
ALTER TABLE test_registry
  DROP COLUMN IF EXISTS source_revision,
  DROP COLUMN IF EXISTS scanner_version,
  DROP COLUMN IF EXISTS repo;
ALTER TABLE graph_edges
  DROP COLUMN IF EXISTS source_revision,
  DROP COLUMN IF EXISTS scanner_version;

DELETE FROM schema_version WHERE version = '397';

COMMIT;
