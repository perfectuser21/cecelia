BEGIN;
CREATE TABLE IF NOT EXISTS headed_task_takeovers (
 task_id UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE RESTRICT,
 generation UUID NOT NULL UNIQUE,
 request_id UUID NOT NULL UNIQUE,
 session_id TEXT NOT NULL CHECK(length(session_id)>0),
 previous_run_id TEXT,
 previous_owner JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX headed_takeover_previous_run ON headed_task_takeovers(previous_run_id);
CREATE INDEX headed_task_current_run ON tasks((payload->>'current_run_id')) WHERE payload->>'current_run_id' IS NOT NULL;
-- writer共享/API独占同一闸；双方try，API不持闸等task，避免资源锁反转。
CREATE FUNCTION headed_lock_task(task UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 IF task IS NULL THEN RETURN; END IF;
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('headed_task_owner:'||task::text,0)) THEN
  RAISE EXCEPTION 'headed_task_owner_busy' USING ERRCODE='55P03';
 END IF;
 PERFORM id FROM tasks WHERE id=task;
 IF NOT FOUND THEN RAISE EXCEPTION 'headed_task_identity_missing'; END IF;
 IF EXISTS(SELECT 1 FROM headed_task_takeovers WHERE task_id=task) THEN
  RAISE EXCEPTION 'headed_task_owned';
 END IF;
END;
$$;
CREATE FUNCTION headed_execution_insert_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE item JSONB; task UUID; parent UUID; run_key TEXT;
 targets UUID[]:=ARRAY[]::uuid[]; run_keys TEXT[]:=ARRAY[]::text[];
BEGIN
 -- 非RC快照可能在取闸后仍看不到已提交owner；不可视作无owner。
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'headed_guard_isolation_unsupported';
 END IF;
 FOR item IN SELECT to_jsonb(NEW) UNION ALL SELECT to_jsonb(OLD) WHERE TG_OP='UPDATE' LOOP
  task:=NULL;run_key:=NULL;
  IF TG_TABLE_NAME IN ('harness_attempts','harness_attempt_cleanup_outbox') THEN
   IF NOT item ? 'run_id' THEN RAISE EXCEPTION 'headed_execution_identity_missing'; END IF;
   parent:=(item->>'run_id')::uuid;
   run_key:=parent::text;
   SELECT current_task_id INTO task FROM initiative_runs WHERE id=parent;
   IF NOT FOUND THEN RAISE EXCEPTION 'headed_execution_parent_missing'; END IF;
  ELSIF TG_TABLE_NAME='initiative_runs' THEN
   IF NOT item ? 'current_task_id' OR NOT item ? 'id' THEN RAISE EXCEPTION 'headed_execution_identity_missing'; END IF;
   task:=(item->>'current_task_id')::uuid;
   run_key:=item->>'id';
  ELSIF TG_TABLE_NAME='device_locks' THEN
   IF NOT item ? 'locked_by' THEN RAISE EXCEPTION 'headed_execution_identity_missing'; END IF;
   task:=NULL;
   IF item->>'locked_by' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN task:=(item->>'locked_by')::uuid; END IF;
  ELSIF TG_TABLE_NAME IN ('task_runs','callback_queue','kernel_controller_sessions','capacity_reservations') THEN
   IF NOT item ? 'task_id' THEN RAISE EXCEPTION 'headed_execution_identity_missing'; END IF;
   task:=(item->>'task_id')::uuid;
   IF task IS NULL THEN RAISE EXCEPTION 'headed_execution_identity_missing'; END IF;
   IF TG_TABLE_NAME<>'capacity_reservations' THEN
    IF NOT item ? 'run_id' THEN RAISE EXCEPTION 'headed_execution_identity_missing'; END IF;
    run_key:=item->>'run_id';
   END IF;
  ELSE RAISE EXCEPTION 'headed_execution_relation_unknown';
  END IF;
  IF task IS NOT NULL THEN targets:=array_append(targets,task); END IF;
  IF run_key IS NOT NULL THEN run_keys:=array_append(run_keys,run_key); END IF;
 END LOOP;
 -- 旧指针在接管事务内清除，immutable previous_run_id保留相同真实映射。
 FOR task IN SELECT DISTINCT id FROM (
  SELECT unnest(targets) AS id
  UNION ALL SELECT id FROM tasks WHERE payload->>'current_run_id'=ANY(run_keys)
  UNION ALL SELECT task_id FROM headed_task_takeovers WHERE previous_run_id=ANY(run_keys)
 ) associated ORDER BY id LOOP
  PERFORM headed_lock_task(task);
 END LOOP;
 RETURN NEW;
END;
$$;
DO $$ DECLARE name TEXT; BEGIN
 FOREACH name IN ARRAY ARRAY['task_runs','callback_queue','kernel_controller_sessions','capacity_reservations','initiative_runs','harness_attempts','harness_attempt_cleanup_outbox','device_locks'] LOOP
  EXECUTE format('CREATE TRIGGER aa_headed_execution_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION headed_execution_insert_guard()',name);
 END LOOP;
END $$;
CREATE FUNCTION headed_task_owner_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner headed_task_takeovers%ROWTYPE;
BEGIN
 SELECT * INTO owner FROM headed_task_takeovers WHERE task_id=OLD.id;
 IF NOT FOUND THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'headed_task_owned'; END IF;
 -- 人赢元数据与镜子同步不改变执行权；未知新列默认仍保护。
 IF (to_jsonb(NEW)-ARRAY['title','description','priority','due_at','notion_id','notion_props','notion_synced_at','updated_at','row_version'])
    IS NOT DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['title','description','priority','due_at','notion_id','notion_props','notion_synced_at','updated_at','row_version']) THEN
  RETURN NEW;
 END IF;
 IF current_setting('cecelia.headed_owner_generation',true) IS DISTINCT FROM owner.generation::text THEN
  RAISE EXCEPTION 'headed_task_owned';
 END IF;
 IF NEW.executor_kind IS DISTINCT FROM 'headed-session'
    OR NEW.payload->'headed_takeover' IS DISTINCT FROM jsonb_build_object('generation',owner.generation::text,'session_id',owner.session_id)
    OR NEW.payload->>'current_run_id' IS NOT NULL THEN
  RAISE EXCEPTION 'headed_task_identity_immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER aa_headed_task_owner_guard BEFORE UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION headed_task_owner_guard();
CREATE FUNCTION headed_takeover_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'headed_takeover_immutable'; END; $$;
CREATE TRIGGER headed_takeover_immutable BEFORE UPDATE OR DELETE ON headed_task_takeovers FOR EACH ROW EXECUTE FUNCTION headed_takeover_immutable();
INSERT INTO schema_version(version,description,applied_at) VALUES('509','有头会话一次性接管legacy bridge及持久执行屏障',NOW()) ON CONFLICT(version) DO NOTHING;
COMMIT;
