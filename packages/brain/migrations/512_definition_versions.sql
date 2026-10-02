BEGIN;
CREATE TABLE IF NOT EXISTS activity_definition_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 activity_id uuid NOT NULL REFERENCES journey_steps(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 contract_sha256 text NOT NULL CHECK(contract_sha256 ~ '^[0-9a-f]{64}$'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 source_repo text NOT NULL,source_path text NOT NULL,source_commit text NOT NULL CHECK(source_commit ~ '^[0-9a-f]{40}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(activity_id,source_repo,source_path,payload_sha256),UNIQUE(activity_id,id)
);
CREATE TABLE IF NOT EXISTS workflow_definition_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workflow_id uuid NOT NULL REFERENCES workflows(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND payload ? 'activities' AND jsonb_typeof(payload->'activities')='array'),
 contract_sha256 text NOT NULL CHECK(contract_sha256 ~ '^[0-9a-f]{64}$'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 source_repo text NOT NULL,source_path text NOT NULL,source_commit text NOT NULL CHECK(source_commit ~ '^[0-9a-f]{40}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workflow_id,source_repo,source_path,payload_sha256),UNIQUE(workflow_id,id)
);
ALTER TABLE activity_definition_versions DROP CONSTRAINT IF EXISTS activity_payload_identity;
ALTER TABLE activity_definition_versions ADD CONSTRAINT activity_payload_identity CHECK(
  COALESCE(payload->>'activity_id'=activity_id::text,false) AND COALESCE(jsonb_typeof(payload->'contract')='object',false));
ALTER TABLE workflow_definition_versions DROP CONSTRAINT IF EXISTS workflow_payload_identity;
ALTER TABLE workflow_definition_versions ADD CONSTRAINT workflow_payload_identity CHECK(
  COALESCE(payload->>'workflow_id'=workflow_id::text,false) AND COALESCE(jsonb_typeof(payload->'contract')='object',false));
CREATE OR REPLACE FUNCTION immutable_definition_version() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '定义快照不可变：禁止UPDATE/DELETE'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS immutable_activity_version ON activity_definition_versions;
CREATE TRIGGER immutable_activity_version BEFORE UPDATE OR DELETE ON activity_definition_versions FOR EACH ROW EXECUTE FUNCTION immutable_definition_version();
DROP TRIGGER IF EXISTS immutable_workflow_version ON workflow_definition_versions;
CREATE TRIGGER immutable_workflow_version BEFORE UPDATE OR DELETE ON workflow_definition_versions FOR EACH ROW EXECUTE FUNCTION immutable_definition_version();
CREATE OR REPLACE FUNCTION workflow_version_references_guard() RETURNS trigger AS $$
DECLARE item jsonb;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.payload->'activities') LOOP
   IF NOT EXISTS(SELECT 1 FROM activity_definition_versions WHERE activity_id=(item->>'activity_id')::uuid AND id=(item->>'activity_version_id')::uuid) THEN
     RAISE EXCEPTION 'Workflow快照引用的Activity版本不存在或对象错配';
   END IF;
 END LOOP;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS workflow_version_references ON workflow_definition_versions;
CREATE TRIGGER workflow_version_references BEFORE INSERT ON workflow_definition_versions FOR EACH ROW EXECUTE FUNCTION workflow_version_references_guard();
ALTER TABLE workflow_activity_refs ADD COLUMN IF NOT EXISTS activity_definition_version_id uuid;
ALTER TABLE workflow_activity_refs DROP CONSTRAINT IF EXISTS workflow_activity_version_identity;
ALTER TABLE workflow_activity_refs ADD CONSTRAINT workflow_activity_version_identity FOREIGN KEY(activity_id,activity_definition_version_id) REFERENCES activity_definition_versions(activity_id,id);
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS current_definition_version_id uuid;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS current_definition_version_id uuid;
ALTER TABLE journey_steps DROP CONSTRAINT IF EXISTS activity_current_version_identity;
ALTER TABLE journey_steps ADD CONSTRAINT activity_current_version_identity FOREIGN KEY(id,current_definition_version_id) REFERENCES activity_definition_versions(activity_id,id);
ALTER TABLE workflows DROP CONSTRAINT IF EXISTS workflow_current_version_identity;
ALTER TABLE workflows ADD CONSTRAINT workflow_current_version_identity FOREIGN KEY(id,current_definition_version_id) REFERENCES workflow_definition_versions(workflow_id,id);
INSERT INTO schema_version(version,description) VALUES('512','不可变Activity/Workflow定义快照与对象身份约束') ON CONFLICT(version) DO NOTHING;
COMMIT;
