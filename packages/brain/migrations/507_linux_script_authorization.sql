CREATE TABLE linux_script_authorizations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),machine_registry_id UUID NOT NULL REFERENCES system_registry(id) ON DELETE RESTRICT,
 expected_version_id UUID,execution_version_id UUID NOT NULL UNIQUE,
 FOREIGN KEY(machine_registry_id,expected_version_id) REFERENCES execution_node_versions(machine_registry_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(machine_registry_id,execution_version_id) REFERENCES execution_node_versions(machine_registry_id,id) ON DELETE RESTRICT,
 evidence_task_id UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
 policy JSONB NOT NULL,policy_digest TEXT NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),grant_ids JSONB NOT NULL,
 nonce TEXT NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
 state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','accepted','active','revoked')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),challenge_expires_at TIMESTAMPTZ NOT NULL,
 authorization_expires_at TIMESTAMPTZ NOT NULL,accepted_at TIMESTAMPTZ,activated_at TIMESTAMPTZ,
 receipt JSONB,signed_payload TEXT,signature TEXT CHECK(signature ~ '^[a-f0-9]{64}$'),
 CHECK(machine_registry_id <> '1a379d80-ad36-47d3-88ba-e545ab299a54'::uuid),
 CHECK((policy->'expected'->>'machine_registry_id'=machine_registry_id::text) IS TRUE),
 CHECK(challenge_expires_at<=created_at+interval '10 minutes'),CHECK(authorization_expires_at<=created_at+interval '24 hours'),
 CHECK((receipt IS NULL AND signed_payload IS NULL AND signature IS NULL AND accepted_at IS NULL) OR
  (receipt IS NOT NULL AND signed_payload IS NOT NULL AND signature IS NOT NULL AND accepted_at IS NOT NULL
   AND receipt=signed_payload::jsonb AND (receipt->>'cleanup_confirmed'='true') IS TRUE
   AND (receipt->>'script_adapter_verified'='true') IS TRUE AND (receipt->>'execution'='false') IS TRUE
   AND (receipt->>'execution_version_id'=execution_version_id::text) IS TRUE AND (receipt->>'nonce'=nonce) IS TRUE)),
 CHECK(state NOT IN ('accepted','active') OR receipt IS NOT NULL)
);
CREATE INDEX linux_script_authorizations_machine ON linux_script_authorizations(machine_registry_id,created_at DESC);
CREATE FUNCTION linux_script_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'linux_script_history_immutable';END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','challenge_expires_at','authorization_expires_at','receipt','signed_payload','signature','accepted_at','activated_at'])<>
     (to_jsonb(OLD)-ARRAY['state','challenge_expires_at','authorization_expires_at','receipt','signed_payload','signature','accepted_at','activated_at'])
   OR NEW.challenge_expires_at>OLD.challenge_expires_at OR NEW.authorization_expires_at>OLD.authorization_expires_at
   OR (OLD.receipt IS NOT NULL AND (NEW.receipt IS DISTINCT FROM OLD.receipt OR NEW.signed_payload IS DISTINCT FROM OLD.signed_payload OR NEW.signature IS DISTINCT FROM OLD.signature OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at))
   OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at)
   OR (OLD.state='revoked' AND NEW.state<>'revoked') OR (OLD.state='active' AND NEW.state NOT IN ('active','revoked'))
   OR (OLD.state='accepted' AND NEW.state NOT IN ('accepted','active','revoked')) OR (OLD.state='prepared' AND NEW.state='active') THEN RAISE EXCEPTION 'linux_script_history_immutable';END IF;
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('harness_attempt_machine:'||(NEW.policy->>'machine_id'),0)) THEN RAISE EXCEPTION 'execution_directory_busy';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER linux_script_history_guard BEFORE INSERT OR UPDATE OR DELETE ON linux_script_authorizations FOR EACH ROW EXECUTE FUNCTION linux_script_history_guard();
-- 保留503不可变历史及legacy合同，仅完整脚本验收可激活attested Linux版本。
CREATE OR REPLACE FUNCTION execution_directory_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical TEXT; mode TEXT; runtime linux_script_authorizations%ROWTYPE; version execution_node_versions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'execution_history_immutable';END IF;
 IF TG_TABLE_NAME='execution_nodes' THEN
  IF TG_OP='UPDATE' AND (NEW.machine_registry_id<>OLD.machine_registry_id OR NEW.canonical_id<>OLD.canonical_id) THEN RAISE EXCEPTION 'execution_identity_immutable';END IF;
  canonical:=NEW.canonical_id;
 ELSIF TG_TABLE_NAME='execution_node_versions' THEN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'state')<>(to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'execution_version_immutable';END IF;
  SELECT canonical_id INTO canonical FROM execution_nodes WHERE machine_registry_id=NEW.machine_registry_id;
  IF NEW.identity_mode='attested-v1' THEN
   IF TG_OP='UPDATE' AND OLD.state='revoked' AND NEW.state<>'revoked' THEN RAISE EXCEPTION 'execution_history_immutable';END IF;
   IF NEW.state='active' THEN
    SELECT * INTO runtime FROM linux_script_authorizations WHERE execution_version_id=NEW.id AND machine_registry_id=NEW.machine_registry_id
      AND state IN ('accepted','active') AND authorization_expires_at>clock_timestamp();
    IF runtime.id IS NULL OR NEW.platform<>'linux' OR NEW.worker_boot_id<>runtime.policy->'expected'->>'worker_boot_id'
      OR NEW.profile->'linux_script' IS DISTINCT FROM runtime.policy->'authority'
      OR NEW.config_hash<>runtime.policy_digest OR NEW.endpoints->>'worker'<>runtime.policy->>'endpoint'
      OR NOT EXISTS(SELECT 1 FROM tasks WHERE id=runtime.evidence_task_id AND status='completed')
      OR NOT EXISTS(SELECT 1 FROM system_registry WHERE id=NEW.machine_registry_id AND type='machine' AND status='active'
       AND COALESCE(metadata->>'role','') NOT IN ('scheduler','scheduler_only') AND COALESCE(metadata->>'scheduler_only','false')<>'true')
      THEN RAISE EXCEPTION 'execution_attested_activation_not_enabled';END IF;
   END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'state'-'expires_at')<>(to_jsonb(OLD)-'state'-'expires_at') THEN RAISE EXCEPTION 'execution_grant_immutable';END IF;
  SELECT v.* INTO version FROM execution_node_versions v WHERE v.id=NEW.node_version_id;
  SELECT canonical_id INTO canonical FROM execution_nodes WHERE machine_registry_id=version.machine_registry_id;mode:=version.identity_mode;
  IF mode='attested-v1' THEN
   IF TG_OP='UPDATE' AND (OLD.state='revoked' AND NEW.state<>'revoked' OR OLD.expires_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at>OLD.expires_at)) THEN RAISE EXCEPTION 'execution_history_immutable';END IF;
   IF NEW.state='active' THEN
    SELECT * INTO runtime FROM linux_script_authorizations WHERE execution_version_id=NEW.node_version_id AND state IN ('accepted','active') AND authorization_expires_at>clock_timestamp();
    IF runtime.id IS NULL OR version.state<>'active' OR NEW.surface<>'managed_script' OR NEW.provider<>'script'
      OR NEW.account_id<>'' OR cardinality(NEW.repo_scope)<>0 OR NEW.provenance<>'linux_script_canary'
      OR (runtime.grant_ids->>NEW.profile_id IS DISTINCT FROM NEW.id::text) OR NEW.evidence_task_id IS DISTINCT FROM runtime.evidence_task_id
      OR NEW.expires_at IS NULL OR NEW.expires_at>runtime.authorization_expires_at OR NEW.expires_at<=clock_timestamp()
      OR NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.evidence_task_id AND status='completed') THEN RAISE EXCEPTION 'execution_evidence_required';END IF;
   END IF;
  END IF;
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('harness_attempt_machine:'||canonical,0)) THEN RAISE EXCEPTION 'execution_directory_busy';END IF;
 RETURN NEW;
END $$;
INSERT INTO schema_version(version,description,applied_at) VALUES('507','Linux受管脚本真实canary验收与同代授权CAS',now()) ON CONFLICT(version) DO NOTHING;
