-- Historical HTTP lease identity only. No grants, execution wiring or SSH backfill.
ALTER TABLE phone_dispatches ADD COLUMN transport_mode TEXT NOT NULL DEFAULT 'ssh' CHECK(transport_mode IN ('ssh','http'));
ALTER TABLE phone_dispatches ADD COLUMN http_binding JSONB;
CREATE FUNCTION guard_phone_http_lease_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v RECORD;canonical TEXT;b JSONB;e JSONB;p JSONB;k TEXT;
BEGIN
 IF NEW.transport_mode='ssh' THEN
  IF NEW.http_binding IS NOT NULL THEN RAISE EXCEPTION 'phone_http_lease_identity_mismatch'; END IF;
  RETURN NEW;
 END IF;
 b:=NEW.http_binding;e:=b-'execution_version_id';p:=e->'physical';
 SELECT * INTO v FROM execution_node_versions WHERE id=NEW.execution_version_id;
 SELECT canonical_id INTO canonical FROM execution_nodes WHERE machine_registry_id=v.machine_registry_id;
 IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'phone_http_lease_identity_mismatch'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(b))<>7
  OR NOT b ?& ARRAY['execution_version_id','http_endpoint','hub_id','hub_boot_id','hub_config_digest','hub_build_digest','physical']
  OR (SELECT count(*) FROM jsonb_object_keys(p))<>6
  OR NOT p ?& ARRAY['machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest']
  THEN RAISE EXCEPTION 'phone_http_lease_identity_mismatch'; END IF;
 FOREACH k IN ARRAY ARRAY['execution_version_id','http_endpoint','hub_id','hub_boot_id','hub_config_digest','hub_build_digest'] LOOP
  IF jsonb_typeof(b->k) IS DISTINCT FROM 'string' OR octet_length(b->>k) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'phone_http_lease_identity_mismatch'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest'] LOOP
  IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR octet_length(p->>k) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'phone_http_lease_identity_mismatch'; END IF;
 END LOOP;
 IF b IS DISTINCT FROM jsonb_build_object('execution_version_id',NEW.execution_version_id::text)||(v.endpoints->'phone_hub')
  OR (e->>'http_endpoint') !~ '^http://([a-z0-9]([a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\]):3459/$'
  OR (e->>'hub_config_digest') !~ '^[a-f0-9]{64}$' OR (e->>'hub_build_digest') !~ '^[a-f0-9]{64}$'
  OR canonical IS DISTINCT FROM NEW.machine_id OR (p->>'machine_id') IS DISTINCT FROM NEW.machine_id
  OR (p->>'worker_id') IS DISTINCT FROM v.worker_id OR (p->>'worker_id') IS DISTINCT FROM NEW.worker_id
  OR (p->>'physical_boot_id') IS DISTINCT FROM NEW.worker_boot_id
  OR (v.worker_boot_id IS NOT NULL AND (p->>'physical_boot_id') IS DISTINCT FROM v.worker_boot_id)
  OR (p->>'config_digest') !~ '^[a-f0-9]{64}$' OR (p->>'build_digest') !~ '^[a-f0-9]{64}$' OR (p->>'action_digest') !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'phone_http_lease_identity_mismatch'; END IF;
 IF NEW.state NOT IN ('reserved','unknown') THEN RAISE EXCEPTION 'phone_http_execution_not_connected'; END IF;
 RETURN NEW;
END $$;
-- Existing 508 guard already makes every new identity column immutable on UPDATE.
CREATE TRIGGER phone_http_lease_identity_guard BEFORE INSERT OR UPDATE ON phone_dispatches
 FOR EACH ROW EXECUTE FUNCTION guard_phone_http_lease_identity();
INSERT INTO schema_version(version,description,applied_at) VALUES('518','Historical immutable phone HTTP lease snapshots; execution remains disconnected',now()) ON CONFLICT(version) DO NOTHING;
