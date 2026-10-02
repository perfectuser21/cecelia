BEGIN;
CREATE TABLE IF NOT EXISTS release_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 release_key text NOT NULL UNIQUE,
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
 environment text NOT NULL,target text NOT NULL,actor text NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS release_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 release_id uuid NOT NULL REFERENCES release_versions(id),
 event_key text NOT NULL,attempt_key text NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 collector text NOT NULL,evidence_ref text NOT NULL,
 observed_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(release_id,event_key),UNIQUE(release_id,id)
);
CREATE TABLE IF NOT EXISTS run_definition_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id text NOT NULL UNIQUE,
 release_id uuid NOT NULL REFERENCES release_versions(id),observation_id uuid NOT NULL,
 workflow_id uuid NOT NULL,workflow_definition_version_id uuid NOT NULL,
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 expected_path jsonb NOT NULL CHECK(jsonb_typeof(expected_path)='array'),
 source_kind text NOT NULL CHECK(source_kind IN ('internal','external')),
 task_run_id uuid REFERENCES task_runs(id),external_origin text,
 attempt_key text NOT NULL,actor text NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(release_id,observation_id) REFERENCES release_observations(release_id,id),
 FOREIGN KEY(workflow_id,workflow_definition_version_id) REFERENCES workflow_definition_versions(workflow_id,id),
 CHECK((source_kind='internal' AND task_run_id IS NOT NULL AND external_origin IS NULL)
    OR (source_kind='external' AND task_run_id IS NULL AND external_origin IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS release_observations_chronology ON release_observations(created_at DESC,id);
CREATE OR REPLACE FUNCTION immutable_release_evidence() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '发布与运行证据不可变：禁止UPDATE/DELETE'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS immutable_release_version ON release_versions;
CREATE TRIGGER immutable_release_version BEFORE UPDATE OR DELETE ON release_versions FOR EACH ROW EXECUTE FUNCTION immutable_release_evidence();
DROP TRIGGER IF EXISTS immutable_release_observation ON release_observations;
CREATE TRIGGER immutable_release_observation BEFORE UPDATE OR DELETE ON release_observations FOR EACH ROW EXECUTE FUNCTION immutable_release_evidence();
DROP TRIGGER IF EXISTS immutable_run_definition_binding ON run_definition_bindings;
CREATE TRIGGER immutable_run_definition_binding BEFORE UPDATE OR DELETE ON run_definition_bindings FOR EACH ROW EXECUTE FUNCTION immutable_release_evidence();
INSERT INTO schema_version(version,description) VALUES('515','不可变发布版本、部署实测与运行定义绑定') ON CONFLICT(version) DO NOTHING;
COMMIT;
