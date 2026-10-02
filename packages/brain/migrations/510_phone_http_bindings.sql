-- Read-only phone HTTP identity contract. No grants, activation or legacy lease backfill.
CREATE FUNCTION phone_http_endpoint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e JSONB; p JSONB; canonical TEXT; k TEXT;
BEGIN
 IF NOT (NEW.endpoints ? 'phone_hub') THEN RETURN NEW; END IF;
 e:=NEW.endpoints->'phone_hub'; p:=e->'physical';
 SELECT canonical_id INTO canonical FROM execution_nodes WHERE machine_registry_id=NEW.machine_registry_id;
 IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'phone_http_endpoint_invalid'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(e))<>6 OR NOT e ?& ARRAY['http_endpoint','hub_id','hub_boot_id','hub_config_digest','hub_build_digest','physical']
  OR (SELECT count(*) FROM jsonb_object_keys(p))<>6 OR NOT p ?& ARRAY['machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest'] THEN RAISE EXCEPTION 'phone_http_endpoint_invalid'; END IF;
 FOREACH k IN ARRAY ARRAY['http_endpoint','hub_id','hub_boot_id','hub_config_digest','hub_build_digest'] LOOP
  IF jsonb_typeof(e->k) IS DISTINCT FROM 'string' OR octet_length(e->>k) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'phone_http_endpoint_invalid'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest'] LOOP
  IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR octet_length(p->>k) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'phone_http_endpoint_invalid'; END IF;
 END LOOP;
 IF (e->>'http_endpoint') !~ '^http://([a-z0-9]([a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\]):3459/$'
  OR (e->>'hub_config_digest') !~ '^[a-f0-9]{64}$' OR (e->>'hub_build_digest') !~ '^[a-f0-9]{64}$'
  OR (p->>'machine_id') IS DISTINCT FROM canonical OR (p->>'worker_id') IS DISTINCT FROM NEW.worker_id
  OR (p->>'config_digest') !~ '^[a-f0-9]{64}$' OR (p->>'build_digest') !~ '^[a-f0-9]{64}$' OR (p->>'action_digest') !~ '^[a-f0-9]{64}$'
  OR (NEW.worker_boot_id IS NOT NULL AND (p->>'physical_boot_id') IS DISTINCT FROM NEW.worker_boot_id) THEN RAISE EXCEPTION 'phone_http_endpoint_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phone_http_endpoint_guard BEFORE INSERT OR UPDATE ON execution_node_versions
 FOR EACH ROW EXECUTE FUNCTION phone_http_endpoint_guard();
INSERT INTO schema_version(version,description,applied_at) VALUES('510','Phone HTTP read-only immutable hub and physical identity binding',now()) ON CONFLICT(version) DO NOTHING;
