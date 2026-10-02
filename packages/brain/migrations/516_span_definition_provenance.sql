BEGIN;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS identity_protocol integer NOT NULL DEFAULT 1;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS run_binding_id uuid REFERENCES run_definition_bindings(id);
ALTER TABLE spans ADD COLUMN IF NOT EXISTS reference_id uuid;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS workflow_definition_version_id uuid REFERENCES workflow_definition_versions(id);
ALTER TABLE spans ADD COLUMN IF NOT EXISTS activity_definition_version_id uuid REFERENCES activity_definition_versions(id);
ALTER TABLE spans ADD COLUMN IF NOT EXISTS attempt_key text;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS enabler_call_id uuid;
ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_definition_identity_check;
ALTER TABLE spans ADD CONSTRAINT spans_definition_identity_check CHECK (
 (identity_protocol=1 AND run_binding_id IS NULL AND reference_id IS NULL
   AND workflow_definition_version_id IS NULL AND activity_definition_version_id IS NULL
   AND attempt_key IS NULL AND enabler_call_id IS NULL)
 OR (identity_protocol=2 AND run_binding_id IS NOT NULL AND reference_id IS NOT NULL
   AND workflow_id IS NOT NULL AND activity_id IS NOT NULL
   AND workflow_definition_version_id IS NOT NULL AND activity_definition_version_id IS NOT NULL
   AND attempt_key IS NOT NULL AND length(btrim(attempt_key))>0 AND occurrence_key IS NOT NULL)
);
CREATE OR REPLACE FUNCTION check_span_run_protocol() RETURNS trigger AS $$
DECLARE binding run_definition_bindings%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.run_id,515));
 SELECT * INTO binding FROM run_definition_bindings WHERE run_id=NEW.run_id;
 IF NEW.identity_protocol=1 AND binding.id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='spans_bound_run_protocol',MESSAGE='固定版本运行禁止降级旧Span协议';
 END IF;
 IF NEW.identity_protocol=2 AND (binding.id IS NULL OR binding.id<>NEW.run_binding_id
   OR binding.workflow_id<>NEW.workflow_id OR binding.workflow_definition_version_id<>NEW.workflow_definition_version_id
   OR binding.attempt_key<>NEW.attempt_key) THEN
   RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='spans_bound_run_identity',MESSAGE='Span与固定运行身份不一致';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS spans_check_run_protocol ON spans;
CREATE TRIGGER spans_check_run_protocol BEFORE INSERT OR UPDATE ON spans FOR EACH ROW EXECUTE FUNCTION check_span_run_protocol();
CREATE INDEX IF NOT EXISTS spans_definition_usage ON spans(run_binding_id,reference_id,step_id) WHERE identity_protocol=2;
-- 同一run命名空间只能有一个归属；旧startRun和直接SQL同样不能冒领外部运行。
CREATE OR REPLACE FUNCTION check_task_run_definition_identity() RETURNS trigger AS $$
DECLARE binding run_definition_bindings%ROWTYPE; existing task_runs%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.run_id,515));
 SELECT * INTO binding FROM run_definition_bindings WHERE run_id=NEW.run_id;
 IF TG_OP='INSERT' THEN SELECT * INTO existing FROM task_runs WHERE run_id=NEW.run_id AND task_id=NEW.task_id; END IF;
 IF binding.id IS NOT NULL AND (binding.source_kind='external' OR binding.task_run_id<>COALESCE(existing.id,NEW.id)
   OR binding.workflow_id IS DISTINCT FROM COALESCE(existing.workflow_id,NEW.workflow_id)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='task_run_definition_identity',MESSAGE='固定运行命名空间已属于另一执行身份';
 END IF;
 IF TG_OP='UPDATE' AND (OLD.run_id IS DISTINCT FROM NEW.run_id OR OLD.task_id IS DISTINCT FROM NEW.task_id)
   AND EXISTS(SELECT 1 FROM run_definition_bindings WHERE task_run_id=OLD.id) THEN
   RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='task_run_definition_identity',MESSAGE='固定运行不得更换任务或运行身份';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS task_runs_check_definition_identity ON task_runs;
CREATE TRIGGER task_runs_check_definition_identity BEFORE INSERT OR UPDATE OF run_id,task_id,workflow_id ON task_runs
 FOR EACH ROW EXECUTE FUNCTION check_task_run_definition_identity();
COMMENT ON COLUMN spans.reference_id IS '冻结Workflow内的Activity引用位置；共享Activity及重复引用分别归属';
COMMENT ON COLUMN spans.enabler_call_id IS '发布版本内冻结的Enabler调用关系；不关联当前可变调用表';
INSERT INTO schema_version(version,description) VALUES('516','Span固定运行/定义身份、批次归属校验与旧协议降级防护') ON CONFLICT(version) DO NOTHING;
COMMIT;
