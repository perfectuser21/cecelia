-- 默认无注册/启用/授权/回填；只有固定内部服务建单，执行状态由后续controller实现。
CREATE TABLE phone_schedule_registrations (
 id UUID PRIMARY KEY,template_id UUID NOT NULL REFERENCES recurring_tasks(id),revision BIGINT NOT NULL CHECK(revision>0),
 state TEXT NOT NULL DEFAULT 'inactive' CHECK(state IN ('inactive','active','revoked')),phone JSONB NOT NULL,
 template_digest TEXT NOT NULL CHECK(template_digest ~ '^[a-f0-9]{64}$'),title TEXT NOT NULL,priority TEXT NOT NULL,
 parent_task_id UUID REFERENCES tasks(id),expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(template_id,revision),UNIQUE(id,template_id,revision)
);
CREATE TABLE phone_scheduled_slots (
 template_id UUID NOT NULL,slot TIMESTAMPTZ NOT NULL,registration_id UUID NOT NULL,revision BIGINT NOT NULL,
 task_id UUID NOT NULL UNIQUE REFERENCES tasks(id),routing_receipt_id UUID NOT NULL UNIQUE REFERENCES work_routing_receipts(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(template_id,slot),
 FOREIGN KEY(registration_id,template_id,revision) REFERENCES phone_schedule_registrations(id,template_id,revision)
);
CREATE TABLE phone_task_owners (
 task_id UUID PRIMARY KEY REFERENCES tasks(id),template_id UUID NOT NULL,slot TIMESTAMPTZ NOT NULL,
 registration_id UUID NOT NULL,revision BIGINT NOT NULL,routing_receipt_id UUID NOT NULL UNIQUE REFERENCES work_routing_receipts(id),phone JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(template_id,slot) REFERENCES phone_scheduled_slots(template_id,slot),
 FOREIGN KEY(registration_id,template_id,revision) REFERENCES phone_schedule_registrations(id,template_id,revision)
);
CREATE FUNCTION guard_phone_schedule_registration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'phone_schedule_registry_managed'; END IF;
 IF current_setting('cecelia.phone_schedule_registry',true) IS DISTINCT FROM NEW.id::text||':'||NEW.revision::text
 OR (TG_OP='INSERT' AND NEW.state<>'inactive')
 OR (TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['state','expires_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','expires_at']))
 THEN RAISE EXCEPTION 'phone_schedule_registry_managed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phone_schedule_registration_guard BEFORE INSERT OR UPDATE OR DELETE ON phone_schedule_registrations FOR EACH ROW EXECUTE FUNCTION guard_phone_schedule_registration();
CREATE FUNCTION immutable_phone_schedule_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'phone_schedule_identity_immutable'; END $$;
CREATE TRIGGER phone_scheduled_slot_immutable BEFORE UPDATE OR DELETE ON phone_scheduled_slots FOR EACH ROW EXECUTE FUNCTION immutable_phone_schedule_identity();
CREATE TRIGGER phone_task_owner_immutable BEFORE UPDATE OR DELETE ON phone_task_owners FOR EACH ROW EXECUTE FUNCTION immutable_phone_schedule_identity();
CREATE FUNCTION guard_phone_scheduled_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; p JSONB; o RECORD;
BEGIN
 IF TG_OP='INSERT' AND NEW.executor_kind='phone-ssh-controller' THEN
  p:=NEW.payload->'phone_schedule';
  SELECT * INTO r FROM phone_schedule_registrations WHERE id::text=p->>'registration_id';
  IF NOT FOUND OR r.state<>'active' OR r.expires_at<=clock_timestamp()
   OR NEW.status<>'queued' OR NEW.kind<>'agent' OR NEW.task_type<>'device_job'
   OR p->>'template_id' IS DISTINCT FROM r.template_id::text OR p->>'revision' IS DISTINCT FROM r.revision::text
   OR p->'phone' IS DISTINCT FROM r.phone
   OR current_setting('cecelia.phone_schedule_admission',true) IS DISTINCT FROM r.id::text||':'||r.revision::text||':'||(p->>'slot')
  THEN RAISE EXCEPTION 'phone_schedule_insert_required'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN RETURN NEW; END IF;
 IF OLD.executor_kind IS DISTINCT FROM 'phone-ssh-controller' AND NEW.executor_kind='phone-ssh-controller' THEN RAISE EXCEPTION 'phone_schedule_insert_required'; END IF;
 SELECT * INTO o FROM phone_task_owners WHERE task_id=OLD.id;
 IF NOT FOUND THEN
  -- 单一writer建单时暂缺owner，仅允许同事务精确附加它刚写的真实routing receipt。
  IF OLD.executor_kind='phone-ssh-controller' AND OLD.payload ? 'phone_schedule' THEN
   IF NEW.payload IS DISTINCT FROM OLD.payload
    AND (to_jsonb(NEW)-'payload') IS NOT DISTINCT FROM (to_jsonb(OLD)-'payload')
    AND NEW.payload-'routing_receipt_id' IS NOT DISTINCT FROM OLD.payload
    AND EXISTS(SELECT 1 FROM work_routing_receipts w WHERE w.task_id=OLD.id AND w.id::text=NEW.payload->>'routing_receipt_id')
    AND current_setting('cecelia.phone_schedule_admission',true) IS NOT DISTINCT FROM (OLD.payload->'phone_schedule'->>'registration_id')||':'||(OLD.payload->'phone_schedule'->>'revision')||':'||(OLD.payload->'phone_schedule'->>'slot')
   THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'phone_scheduled_task_managed';
  END IF;
  RETURN NEW; -- 既有508租约不回填，仍由原phone_managed_task_guard保护。
 END IF;
 IF (to_jsonb(NEW)-ARRAY['title','description','priority','due_at','notion_props','notion_id','notion_synced_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['title','description','priority','due_at','notion_props','notion_id','notion_synced_at','updated_at'])
 THEN RAISE EXCEPTION 'phone_scheduled_task_managed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phone_scheduled_task_guard BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION guard_phone_scheduled_task();
CREATE FUNCTION verify_phone_schedule_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t RECORD;o RECORD;s RECORD;r RECORD;w RECORD;target_task_id UUID;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN target_task_id:=NEW.id;IF NEW.executor_kind IS DISTINCT FROM 'phone-ssh-controller' OR NOT NEW.payload ? 'phone_schedule' THEN RETURN NULL; END IF;
 ELSE target_task_id:=NEW.task_id; END IF;
 SELECT * INTO t FROM tasks WHERE id=target_task_id;
 SELECT * INTO o FROM phone_task_owners WHERE phone_task_owners.task_id=target_task_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'phone_schedule_owner_required'; END IF;
 SELECT * INTO s FROM phone_scheduled_slots WHERE template_id=o.template_id AND slot=o.slot;
 SELECT * INTO r FROM phone_schedule_registrations WHERE id=o.registration_id;
 SELECT * INTO w FROM work_routing_receipts WHERE id=o.routing_receipt_id;
 IF r.state IS DISTINCT FROM 'active' OR r.expires_at<=clock_timestamp()
  OR t.status<>'queued' OR t.task_type<>'device_job' OR t.executor_kind<>'phone-ssh-controller' OR t.kind<>'agent'
  OR (s.task_id,s.registration_id,s.revision,s.routing_receipt_id) IS DISTINCT FROM (o.task_id,o.registration_id,o.revision,o.routing_receipt_id)
  OR r.phone IS DISTINCT FROM o.phone OR w.task_id IS DISTINCT FROM t.id OR w.source IS DISTINCT FROM 'scheduler'
  OR w.source_id IS DISTINCT FROM 'recurring:'||o.template_id::text||':'||(t.payload->'phone_schedule'->>'slot')
  OR t.payload->>'routing_receipt_id' IS DISTINCT FROM w.id::text
  OR t.payload->'phone_schedule'->>'template_id' IS DISTINCT FROM o.template_id::text
  OR t.payload->'phone_schedule'->>'registration_id' IS DISTINCT FROM o.registration_id::text
  OR t.payload->'phone_schedule'->>'revision' IS DISTINCT FROM o.revision::text
  OR t.payload->'phone_schedule'->'phone' IS DISTINCT FROM o.phone
  OR (t.payload->'phone_schedule'->>'slot')::timestamptz IS DISTINCT FROM o.slot
 THEN RAISE EXCEPTION 'phone_schedule_owner_required'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER phone_scheduled_task_commit AFTER INSERT ON tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_phone_schedule_commit();
CREATE CONSTRAINT TRIGGER phone_scheduled_slot_commit AFTER INSERT ON phone_scheduled_slots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_phone_schedule_commit();
CREATE CONSTRAINT TRIGGER phone_scheduled_owner_commit AFTER INSERT ON phone_task_owners DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_phone_schedule_commit();
INSERT INTO schema_version(version,description) VALUES('513','受信phone定时slot、真实路由回执与queued早期owner保护') ON CONFLICT(version) DO NOTHING;
