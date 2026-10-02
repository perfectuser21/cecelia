-- 手机独立执行面：默认没有授权，不启动任何进程。
ALTER TABLE execution_grants DROP CONSTRAINT execution_grants_surface_check;
ALTER TABLE execution_grants ADD CONSTRAINT execution_grants_surface_check CHECK(surface IN ('harness','legacy_executor','managed_script','app_server','phone_ssh'));
ALTER TABLE capacity_reservations DROP CONSTRAINT capacity_reservations_owner_kind_check;
ALTER TABLE capacity_reservations ADD CONSTRAINT capacity_reservations_owner_kind_check CHECK(owner_kind IN ('script','app_server','phone'));
DO $$ DECLARE item RECORD; definition TEXT; BEGIN
 FOR item IN SELECT * FROM (VALUES ('tasks_executor_kind_check','executor_kind','phone-ssh-controller')) AS x(name,col,value) LOOP
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='tasks'::regclass AND conname=item.name;
  IF definition IS NULL THEN RAISE EXCEPTION 'missing task contract %',item.name; END IF;
  EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I',item.name);
  EXECUTE format('ALTER TABLE tasks ADD CONSTRAINT %I CHECK ((%s) OR %I=%L)',item.name,substring(definition FROM 8 FOR length(definition)-8),item.col,item.value);
 END LOOP;
END $$;
CREATE TABLE phone_dispatches (
 id UUID PRIMARY KEY,
 task_id UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
 reservation_id UUID NOT NULL UNIQUE REFERENCES capacity_reservations(id) ON DELETE RESTRICT,
 serial TEXT NOT NULL REFERENCES phone_registry(serial) ON DELETE RESTRICT,
 machine_id TEXT NOT NULL REFERENCES execution_nodes(canonical_id),
 config_digest TEXT NOT NULL CHECK(config_digest ~ '^[a-f0-9]{64}$'),
 host TEXT NOT NULL CHECK(length(host)>0),profile TEXT NOT NULL CHECK(length(profile)>0),account_id TEXT NOT NULL CHECK(length(account_id)>0),
 execution_version_id UUID NOT NULL REFERENCES execution_node_versions(id),
 execution_grant_id UUID NOT NULL,
 lease_token UUID NOT NULL UNIQUE,execution_id UUID NOT NULL UNIQUE,
 worker_id TEXT NOT NULL CHECK(length(worker_id)>0),worker_boot_id TEXT NOT NULL CHECK(length(worker_boot_id)>0),
 action TEXT NOT NULL DEFAULT 'adb_get_state' CHECK(action='adb_get_state'),
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','launching','unknown','running','terminal')),
 terminal_receipt JSONB,terminal_digest TEXT,terminal_status TEXT CHECK(terminal_status IN ('completed','failed')),
 transition_txid BIGINT NOT NULL DEFAULT txid_current(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_error TEXT,
 FOREIGN KEY(execution_grant_id,execution_version_id) REFERENCES execution_grants(id,node_version_id),
 CHECK((state='terminal')=(terminal_receipt IS NOT NULL AND terminal_digest IS NOT NULL AND terminal_status IS NOT NULL))
);
CREATE FUNCTION guard_phone_dispatch_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD;g RECORD;n RECORD;p RECORD;binding TEXT;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'phone_identity_immutable'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','terminal_receipt','terminal_digest','terminal_status','transition_txid','updated_at','last_error'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','terminal_receipt','terminal_digest','terminal_status','transition_txid','updated_at','last_error'])
   THEN RAISE EXCEPTION 'phone_identity_immutable'; END IF;
  IF OLD.state='terminal' THEN RAISE EXCEPTION 'phone_terminal_immutable'; END IF;
  IF NEW.state='reserved' OR (NEW.state='launching' AND OLD.state<>'reserved')
   OR (NEW.state='running' AND OLD.state NOT IN ('launching','unknown','running')) THEN RAISE EXCEPTION 'phone_transition_forbidden'; END IF;
 ELSE
  IF NEW.state<>'reserved' THEN RAISE EXCEPTION 'phone_initial_state_invalid'; END IF;
 END IF;
 SELECT * INTO r FROM capacity_reservations WHERE id=NEW.reservation_id;
 SELECT * INTO g FROM execution_grants WHERE id=NEW.execution_grant_id;
 SELECT * INTO n FROM execution_node_versions WHERE id=NEW.execution_version_id;
 IF r.owner_kind IS DISTINCT FROM 'phone' OR r.task_id IS DISTINCT FROM NEW.task_id OR r.machine_id IS DISTINCT FROM NEW.machine_id
  OR r.owner_key IS DISTINCT FROM 'phone-'||NEW.id::text OR r.intent_id IS DISTINCT FROM NEW.execution_id
  OR r.execution_version_id IS DISTINCT FROM NEW.execution_version_id OR r.execution_grant_id IS DISTINCT FROM NEW.execution_grant_id
  OR r.config_digest IS DISTINCT FROM NEW.config_digest
  OR r.worker_id IS DISTINCT FROM NEW.worker_id OR r.worker_boot_id IS DISTINCT FROM NEW.worker_boot_id
  OR g.surface IS DISTINCT FROM 'phone_ssh' OR g.provider IS DISTINCT FROM 'adb'
  OR g.account_id IS DISTINCT FROM NEW.account_id OR g.profile_id IS DISTINCT FROM NEW.action
  OR n.endpoints->'phone_ssh'->>'host' IS DISTINCT FROM NEW.host THEN RAISE EXCEPTION 'phone_reservation_identity_mismatch'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND task_type='device_job' AND executor_kind='phone-ssh-controller' AND status IN ('queued','in_progress')) THEN RAISE EXCEPTION 'phone_task_identity_invalid'; END IF;
  SELECT * INTO p FROM phone_registry WHERE serial=NEW.serial;
  IF p.enabled IS DISTINCT FROM true OR p.host IS DISTINCT FROM NEW.host OR p.profile IS DISTINCT FROM NEW.profile
   OR (SELECT count(*) FROM jsonb_array_elements(p.douyin_accounts) a WHERE a->>'current'='true')<>1
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.douyin_accounts) a WHERE a->>'current'='true' AND a->>'id'=NEW.account_id)
   OR g.state<>'active' OR (g.expires_at IS NOT NULL AND g.expires_at<=clock_timestamp())
   OR NOT EXISTS(SELECT 1 FROM execution_nodes e JOIN system_registry s ON s.id=e.machine_registry_id
    WHERE e.canonical_id=NEW.machine_id AND e.current_version_id=NEW.execution_version_id AND s.status='active' AND n.state='active')
  THEN RAISE EXCEPTION 'phone_registry_or_grant_mismatch'; END IF;
 END IF;
 IF NEW.state='terminal' THEN
  IF OLD.state='reserved' AND NEW.terminal_status='completed' THEN RAISE EXCEPTION 'phone_completion_before_launch'; END IF;
  FOREACH binding IN ARRAY ARRAY['reservation_id','task_id','machine_id','host','serial','profile','account_id','execution_version_id','execution_grant_id','lease_token','execution_id','worker_id','worker_boot_id','action','config_digest'] LOOP
   IF NEW.terminal_receipt->>binding IS DISTINCT FROM to_jsonb(NEW)->>binding THEN RAISE EXCEPTION 'phone_terminal_receipt_required'; END IF;
  END LOOP;
  IF NEW.terminal_receipt->>'status' IS DISTINCT FROM NEW.terminal_status
   OR NEW.terminal_receipt->>'dispatch_id' IS DISTINCT FROM NEW.id::text
   OR NEW.terminal_receipt->>'execution_exited' IS DISTINCT FROM 'true'
   OR NEW.terminal_receipt->>'lock_released' IS DISTINCT FROM 'true'
   OR NEW.terminal_receipt->>'lock_owner' IS DISTINCT FROM NEW.lease_token::text
  THEN RAISE EXCEPTION 'phone_terminal_receipt_required'; END IF;
 END IF;
 NEW.transition_txid:=txid_current();RETURN NEW;
END $$;
CREATE TRIGGER phone_dispatch_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON phone_dispatches FOR EACH ROW EXECUTE FUNCTION guard_phone_dispatch_identity();
CREATE FUNCTION guard_phone_managed_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d RECORD;r RECORD;
BEGIN
 SELECT * INTO d FROM phone_dispatches WHERE task_id=OLD.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NEW.task_type IS DISTINCT FROM OLD.task_type OR NEW.executor_kind IS DISTINCT FROM OLD.executor_kind
  OR NEW.payload->>'phone_dispatch_id' IS DISTINCT FROM d.id::text THEN RAISE EXCEPTION 'phone_task_managed'; END IF;
 IF (OLD.payload->>'phone_dispatch_id' IS NOT NULL AND NEW.payload IS DISTINCT FROM OLD.payload)
  OR ((NEW.claimed_by,NEW.claimed_at) IS DISTINCT FROM (OLD.claimed_by,OLD.claimed_at) AND NOT (d.transition_txid=txid_current() AND d.state IN ('reserved','terminal')))
  THEN RAISE EXCEPTION 'phone_task_managed'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  SELECT * INTO r FROM capacity_reservations WHERE id=d.reservation_id;
  IF d.transition_txid<>txid_current() OR NOT ((d.state='reserved' AND NEW.status='in_progress')
   OR (d.state='terminal' AND NEW.status=d.terminal_status AND r.status='released' AND r.confirmed_receipt=d.terminal_receipt))
  THEN RAISE EXCEPTION 'phone_task_managed'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phone_managed_task_guard BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION guard_phone_managed_task();
CREATE FUNCTION guard_phone_capacity_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d RECORD;
BEGIN
 IF OLD.owner_kind='phone' AND NEW.status='released' THEN
  SELECT * INTO d FROM phone_dispatches WHERE reservation_id=OLD.id;
  IF NOT FOUND OR d.state<>'terminal' OR d.transition_txid<>txid_current() OR NEW.confirmed_receipt IS DISTINCT FROM d.terminal_receipt
   THEN RAISE EXCEPTION 'phone_release_unconfirmed'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phone_capacity_release_guard BEFORE UPDATE ON capacity_reservations FOR EACH ROW EXECUTE FUNCTION guard_phone_capacity_release();
INSERT INTO schema_version(version,description,applied_at) VALUES('507','手机独立持久身份、共享整机预约与旧writer守卫',now()) ON CONFLICT(version) DO NOTHING;
