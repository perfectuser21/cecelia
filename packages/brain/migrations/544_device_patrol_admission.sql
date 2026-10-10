-- 固定来源首次引入的独立准入账。既有scope及生产Run不做任何伪回填。
CREATE TABLE IF NOT EXISTS implementation_scope_bootstraps (
 scope_key text NOT NULL,
 source_repo text NOT NULL,
 base_revision text NOT NULL CHECK(base_revision ~ '^[a-f0-9]{40}$'),
 introduced_revision text NOT NULL CHECK(introduced_revision ~ '^[a-f0-9]{40}$'),
 registration jsonb NOT NULL,
 registration_sha256 text NOT NULL CHECK(registration_sha256 ~ '^[a-f0-9]{64}$'),
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY(scope_key,source_repo)
);
INSERT INTO schema_version(version,description) VALUES('544','device patrol fixed Git admission') ON CONFLICT(version) DO NOTHING;
