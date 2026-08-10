-- Migration 397: versioned fact snapshot metadata and repo-scoped identities

BEGIN;

ALTER TABLE api_registry
  ADD COLUMN IF NOT EXISTS repo VARCHAR(100) NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS source_revision TEXT NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS scanner_version VARCHAR(100) NOT NULL DEFAULT 'legacy';

ALTER TABLE db_schema_registry
  ADD COLUMN IF NOT EXISTS repo VARCHAR(100) NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS source_revision TEXT NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS scanner_version VARCHAR(100) NOT NULL DEFAULT 'legacy';

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS repo VARCHAR(100) NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS source_revision TEXT NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS scanner_version VARCHAR(100) NOT NULL DEFAULT 'legacy';

ALTER TABLE graph_edges
  ADD COLUMN IF NOT EXISTS source_revision TEXT NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS scanner_version VARCHAR(100) NOT NULL DEFAULT 'legacy';

ALTER TABLE api_registry
  DROP CONSTRAINT IF EXISTS api_registry_method_path_key,
  DROP CONSTRAINT IF EXISTS api_registry_repo_method_path_key;
ALTER TABLE api_registry
  ADD CONSTRAINT api_registry_repo_method_path_key UNIQUE (repo, method, path);

ALTER TABLE db_schema_registry
  DROP CONSTRAINT IF EXISTS db_schema_registry_table_name_key,
  DROP CONSTRAINT IF EXISTS db_schema_registry_repo_table_name_key;
ALTER TABLE db_schema_registry
  ADD CONSTRAINT db_schema_registry_repo_table_name_key UNIQUE (repo, table_name);

ALTER TABLE test_registry
  DROP CONSTRAINT IF EXISTS test_registry_file_path_key,
  DROP CONSTRAINT IF EXISTS test_registry_repo_file_path_key;
ALTER TABLE test_registry
  ADD CONSTRAINT test_registry_repo_file_path_key UNIQUE (repo, file_path);

CREATE INDEX IF NOT EXISTS idx_api_registry_repo_scanned_at
  ON api_registry (repo, scanned_at);
CREATE INDEX IF NOT EXISTS idx_db_schema_registry_repo_scanned_at
  ON db_schema_registry (repo, scanned_at);
CREATE INDEX IF NOT EXISTS idx_test_registry_repo_scanned_at
  ON test_registry (repo, scanned_at);
CREATE INDEX IF NOT EXISTS idx_graph_edges_repo_scanned_at
  ON graph_edges (repo, scanned_at);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('397', 'Versioned fact snapshot metadata and repo-scoped identities', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
