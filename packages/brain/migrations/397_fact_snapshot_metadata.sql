-- Migration 397: versioned fact snapshot metadata and repo-scoped identities

BEGIN;

ALTER TABLE api_registry
  ADD COLUMN IF NOT EXISTS repo VARCHAR(100) NOT NULL DEFAULT 'cecelia',
  ADD COLUMN IF NOT EXISTS source_revision TEXT NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS scanner_version VARCHAR(100) NOT NULL DEFAULT 'legacy';

ALTER TABLE db_schema_registry
  ADD COLUMN IF NOT EXISTS repo VARCHAR(100) NOT NULL DEFAULT 'cecelia',
  ADD COLUMN IF NOT EXISTS source_revision TEXT NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS scanner_version VARCHAR(100) NOT NULL DEFAULT 'legacy';

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS repo VARCHAR(100) NOT NULL DEFAULT 'cecelia',
  ADD COLUMN IF NOT EXISTS source_revision TEXT NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS scanner_version VARCHAR(100) NOT NULL DEFAULT 'legacy';

ALTER TABLE graph_edges
  ADD COLUMN IF NOT EXISTS source_revision TEXT NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS scanner_version VARCHAR(100) NOT NULL DEFAULT 'legacy';

-- 旧版 397 曾把 registry 存量归到 legacy-unknown。重跑时先保留已经由
-- cecelia scanner 接管的事实，再把无冲突的旧事实统一归回 cecelia。
DELETE FROM api_registry AS legacy
USING api_registry AS owned
WHERE legacy.repo = 'legacy-unknown'
  AND owned.repo = 'cecelia'
  AND legacy.method = owned.method
  AND legacy.path = owned.path;

DELETE FROM db_schema_registry AS legacy
USING db_schema_registry AS owned
WHERE legacy.repo = 'legacy-unknown'
  AND owned.repo = 'cecelia'
  AND legacy.table_name = owned.table_name;

DELETE FROM test_registry AS legacy
USING test_registry AS owned
WHERE legacy.repo = 'legacy-unknown'
  AND owned.repo = 'cecelia'
  AND legacy.file_path = owned.file_path;

UPDATE api_registry SET repo = 'cecelia' WHERE repo = 'legacy-unknown';
UPDATE db_schema_registry SET repo = 'cecelia' WHERE repo = 'legacy-unknown';
UPDATE test_registry SET repo = 'cecelia' WHERE repo = 'legacy-unknown';

-- ADD COLUMN IF NOT EXISTS 不会修正旧版 397 已存在列的默认值，必须显式收敛。
ALTER TABLE api_registry
  ALTER COLUMN repo SET DEFAULT 'cecelia',
  ALTER COLUMN source_revision SET DEFAULT 'legacy-unknown',
  ALTER COLUMN scanner_version SET DEFAULT 'legacy';
ALTER TABLE db_schema_registry
  ALTER COLUMN repo SET DEFAULT 'cecelia',
  ALTER COLUMN source_revision SET DEFAULT 'legacy-unknown',
  ALTER COLUMN scanner_version SET DEFAULT 'legacy';
ALTER TABLE test_registry
  ALTER COLUMN repo SET DEFAULT 'cecelia',
  ALTER COLUMN source_revision SET DEFAULT 'legacy-unknown',
  ALTER COLUMN scanner_version SET DEFAULT 'legacy';

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
