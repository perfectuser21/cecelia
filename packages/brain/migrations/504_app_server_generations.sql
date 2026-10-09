-- 独立执行面，默认没有授权、没有HOME配置、没有启动动作。
ALTER TABLE execution_grants DROP CONSTRAINT execution_grants_surface_check;
ALTER TABLE execution_grants ADD CONSTRAINT execution_grants_surface_check CHECK(surface IN ('harness','legacy_executor','managed_script','app_server'));
ALTER TABLE capacity_reservations DROP CONSTRAINT capacity_reservations_owner_kind_check;
ALTER TABLE capacity_reservations ADD CONSTRAINT capacity_reservations_owner_kind_check CHECK(owner_kind IN ('script','app_server'));
DO $$ DECLARE item RECORD; definition TEXT; BEGIN
 FOR item IN SELECT * FROM (VALUES ('tasks_task_type_check','task_type','app_server_run'),('tasks_executor_kind_check','executor_kind','app-server-controller')) AS x(name,col,value) LOOP
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='tasks'::regclass AND conname=item.name;
  IF definition IS NULL THEN RAISE EXCEPTION 'missing task contract %',item.name; END IF;
  EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I',item.name);
  EXECUTE format('ALTER TABLE tasks ADD CONSTRAINT %I CHECK ((%s) OR %I=%L)',item.name,substring(definition FROM 8 FOR length(definition)-8),item.col,item.value);
 END LOOP;
END $$;
CREATE TABLE app_server_homes (
 home_key TEXT PRIMARY KEY CHECK(home_key ~ '^[a-f0-9]{64}$'),
 home_id TEXT NOT NULL UNIQUE,
 machine_id TEXT NOT NULL REFERENCES execution_nodes(canonical_id),
 config JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE app_server_generations (
 reservation_id UUID PRIMARY KEY REFERENCES capacity_reservations(id),
 home_key TEXT NOT NULL REFERENCES app_server_homes(home_key),
 request_key UUID NOT NULL,
 generation BIGINT NOT NULL CHECK(generation>0),
 cancel_requested BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(home_key,request_key), UNIQUE(home_key,generation)
);
CREATE FUNCTION guard_app_server_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; h RECORD; g RECORD;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'appserver_identity_immutable'; END IF;
 IF TG_TABLE_NAME='app_server_homes' THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'appserver_home_affinity_immutable'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND ((NEW.reservation_id,NEW.home_key,NEW.request_key,NEW.generation,NEW.created_at) IS DISTINCT FROM
   (OLD.reservation_id,OLD.home_key,OLD.request_key,OLD.generation,OLD.created_at) OR (OLD.cancel_requested AND NOT NEW.cancel_requested))
  THEN RAISE EXCEPTION 'appserver_identity_immutable'; END IF;
  SELECT * INTO r FROM capacity_reservations WHERE id=NEW.reservation_id;
  SELECT * INTO h FROM app_server_homes WHERE home_key=NEW.home_key;
  SELECT * INTO g FROM execution_grants WHERE id=r.execution_grant_id;
  IF g.surface IS DISTINCT FROM 'app_server' OR g.provider IS DISTINCT FROM h.config->>'provider' OR g.account_id IS DISTINCT FROM h.config->>'account'
   OR g.profile_id IS DISTINCT FROM h.config->>'profile' OR NOT ((h.config->>'repo')=ANY(g.repo_scope)) OR r.config_digest IS DISTINCT FROM h.config->>'configDigest'
  THEN RAISE EXCEPTION 'appserver_grant_identity_mismatch'; END IF;
  IF r.owner_kind IS DISTINCT FROM 'app_server' OR r.machine_id IS DISTINCT FROM h.machine_id OR r.launch_generation IS DISTINCT FROM NEW.generation
   OR r.execution_version_id IS NULL OR r.execution_grant_id IS NULL OR r.worker_id IS NULL OR r.worker_boot_id IS NULL
  THEN RAISE EXCEPTION 'appserver_reservation_identity_mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER app_server_home_immutable BEFORE UPDATE OR DELETE ON app_server_homes FOR EACH ROW EXECUTE FUNCTION guard_app_server_identity();
CREATE TRIGGER app_server_generation_identity BEFORE INSERT OR UPDATE OR DELETE ON app_server_generations FOR EACH ROW EXECUTE FUNCTION guard_app_server_identity();
INSERT INTO schema_version(version,description,applied_at) VALUES('504','独立app-server HOME亲和与generation整机预约',now()) ON CONFLICT(version) DO NOTHING;
