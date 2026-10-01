CREATE TABLE execution_nodes (
 machine_registry_id UUID PRIMARY KEY REFERENCES system_registry(id) ON DELETE RESTRICT,
 canonical_id TEXT NOT NULL UNIQUE CHECK(length(canonical_id)>0), current_version_id UUID
);
CREATE TABLE execution_node_versions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 machine_registry_id UUID NOT NULL REFERENCES execution_nodes(machine_registry_id) ON DELETE RESTRICT,
 revision BIGINT NOT NULL CHECK(revision>0), identity_mode TEXT NOT NULL CHECK(identity_mode IN ('legacy-v1','attested-v1')),
 worker_id TEXT NOT NULL CHECK(length(worker_id)>0), worker_boot_id TEXT,
 platform TEXT NOT NULL, endpoints JSONB NOT NULL, profile JSONB NOT NULL, config_hash TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','revoked')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(machine_registry_id,revision), UNIQUE(machine_registry_id,id),
 CHECK(identity_mode<>'attested-v1' OR (worker_boot_id IS NOT NULL AND length(worker_boot_id)>0 AND length(config_hash)=64))
);
ALTER TABLE execution_nodes ADD CONSTRAINT execution_current_version_fk FOREIGN KEY(machine_registry_id,current_version_id)
 REFERENCES execution_node_versions(machine_registry_id,id) ON DELETE RESTRICT;
CREATE TABLE execution_grants (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),node_version_id UUID NOT NULL REFERENCES execution_node_versions(id) ON DELETE RESTRICT,
 surface TEXT NOT NULL CHECK(surface IN ('harness','legacy_executor','managed_script')),
 provider TEXT NOT NULL,account_id TEXT NOT NULL DEFAULT '',repo_scope TEXT[] NOT NULL DEFAULT '{}',profile_id TEXT NOT NULL DEFAULT '',
 provenance TEXT NOT NULL,evidence_task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','revoked')),expires_at TIMESTAMPTZ,
 UNIQUE(node_version_id,surface,provider,account_id,repo_scope,profile_id)
);
ALTER TABLE capacity_reservations ADD COLUMN execution_version_id UUID REFERENCES execution_node_versions(id) ON DELETE RESTRICT,
 ADD COLUMN execution_grant_id UUID REFERENCES execution_grants(id) ON DELETE RESTRICT;
CREATE FUNCTION execution_directory_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical TEXT; mode TEXT;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'execution_history_immutable'; END IF;
 IF TG_TABLE_NAME='execution_nodes' THEN
  IF TG_OP='UPDATE' AND (NEW.machine_registry_id<>OLD.machine_registry_id OR NEW.canonical_id<>OLD.canonical_id) THEN RAISE EXCEPTION 'execution_identity_immutable';END IF;
  canonical:=NEW.canonical_id;
 ELSIF TG_TABLE_NAME='execution_node_versions' THEN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'state')<>(to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'execution_version_immutable';END IF;
  SELECT canonical_id INTO canonical FROM execution_nodes WHERE machine_registry_id=NEW.machine_registry_id;
  IF NEW.identity_mode='attested-v1' AND NEW.state='active' THEN RAISE EXCEPTION 'execution_attested_activation_not_enabled';END IF;
 ELSE
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'state'-'expires_at')<>(to_jsonb(OLD)-'state'-'expires_at') THEN RAISE EXCEPTION 'execution_grant_immutable';END IF;
  SELECT n.canonical_id,v.identity_mode INTO canonical,mode FROM execution_node_versions v JOIN execution_nodes n USING(machine_registry_id) WHERE v.id=NEW.node_version_id;
  IF mode='attested-v1' AND NEW.state='active' AND (NEW.evidence_task_id IS NULL OR NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.evidence_task_id AND status='completed')) THEN RAISE EXCEPTION 'execution_evidence_required';END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('harness_attempt_machine:'||canonical,0));
 RETURN NEW;
END $$;
CREATE TRIGGER execution_nodes_guard BEFORE INSERT OR UPDATE OR DELETE ON execution_nodes FOR EACH ROW EXECUTE FUNCTION execution_directory_guard();
CREATE TRIGGER execution_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON execution_node_versions FOR EACH ROW EXECUTE FUNCTION execution_directory_guard();
CREATE TRIGGER execution_grants_guard BEFORE INSERT OR UPDATE OR DELETE ON execution_grants FOR EACH ROW EXECUTE FUNCTION execution_directory_guard();
INSERT INTO schema_version(version,description,applied_at) VALUES('503','不可变执行目录与精确授权',now()) ON CONFLICT(version) DO NOTHING;
