BEGIN;
ALTER TABLE activity_cells ADD COLUMN IF NOT EXISTS assertion_source_repo TEXT;
ALTER TABLE activity_cells ADD CONSTRAINT activity_cells_assertion_source_repo_check
 CHECK (assertion_source_repo IS NULL OR assertion_source_repo ~ '^[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*$');
INSERT INTO schema_version(version,description) VALUES('537','回归断言显式仓库来源；保留历史 null 与原登记 key') ON CONFLICT(version) DO NOTHING;
COMMIT;
