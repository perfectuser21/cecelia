-- 验收与授权准备是真表；pending Linux服务没有执行adapter，503 active硬拒保持。
CREATE TABLE linux_pool_challenges (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), machine_registry_id UUID NOT NULL REFERENCES system_registry(id) ON DELETE RESTRICT,
 expected_version_id UUID,
 FOREIGN KEY(machine_registry_id,expected_version_id) REFERENCES execution_node_versions(machine_registry_id,id) ON DELETE RESTRICT,
 expected JSONB NOT NULL, policy_digest TEXT NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),
 nonce TEXT NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
 state TEXT NOT NULL DEFAULT 'issued' CHECK(state IN ('issued','accepted','revoked')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(), expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ, CHECK(expires_at <= created_at + interval '5 minutes'),
 CHECK(machine_registry_id <> '1a379d80-ad36-47d3-88ba-e545ab299a54'::uuid),
 CHECK(expected->>'machine_registry_id'=machine_registry_id::text)
);
CREATE TABLE linux_pool_attestations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), challenge_id UUID NOT NULL UNIQUE REFERENCES linux_pool_challenges(id) ON DELETE RESTRICT,
 machine_registry_id UUID NOT NULL REFERENCES system_registry(id) ON DELETE RESTRICT,
 receipt JSONB NOT NULL, signed_payload TEXT NOT NULL, signature TEXT NOT NULL CHECK(signature ~ '^[a-f0-9]{64}$'),
 state TEXT NOT NULL DEFAULT 'accepted' CHECK(state IN ('accepted','ready','revoked')),
 accepted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(), expires_at TIMESTAMPTZ NOT NULL,
 execution_version_id UUID UNIQUE,
 FOREIGN KEY(machine_registry_id,execution_version_id) REFERENCES execution_node_versions(machine_registry_id,id) ON DELETE RESTRICT,
 CHECK(receipt=signed_payload::jsonb),CHECK((receipt->>'cleanup_confirmed'='true') IS TRUE),
 CHECK((receipt->>'execution'='false') IS TRUE),CHECK(receipt->>'machine_registry_id'=machine_registry_id::text),
 CHECK(expires_at<=accepted_at+interval '15 minutes')
);
CREATE INDEX linux_pool_attestations_machine ON linux_pool_attestations(machine_registry_id,accepted_at DESC);
CREATE FUNCTION linux_pool_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical TEXT;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'linux_pool_history_immutable';END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='linux_pool_challenges' THEN
   IF (to_jsonb(NEW)-'state'-'consumed_at'-'expires_at')<>(to_jsonb(OLD)-'state'-'consumed_at'-'expires_at')
    OR NEW.expires_at>OLD.expires_at OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
    OR (OLD.state='revoked' AND NEW.state<>'revoked') OR (OLD.state='accepted' AND NEW.state='issued') THEN RAISE EXCEPTION 'linux_pool_history_immutable';END IF;
  ELSE
   IF (to_jsonb(NEW)-'state'-'execution_version_id'-'expires_at')<>(to_jsonb(OLD)-'state'-'execution_version_id'-'expires_at')
    OR NEW.expires_at>OLD.expires_at OR (OLD.execution_version_id IS NOT NULL AND NEW.execution_version_id IS DISTINCT FROM OLD.execution_version_id)
    OR (OLD.state='revoked' AND NEW.state<>'revoked') OR (OLD.state='ready' AND NEW.state='accepted') THEN RAISE EXCEPTION 'linux_pool_history_immutable';END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='linux_pool_challenges' THEN canonical:=NEW.expected->>'machine_id';
 ELSE SELECT expected->>'machine_id' INTO canonical FROM linux_pool_challenges WHERE id=NEW.challenge_id AND machine_registry_id=NEW.machine_registry_id;END IF;
 IF canonical IS NULL THEN RAISE EXCEPTION 'linux_pool_identity_invalid';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('harness_attempt_machine:'||canonical,0)) THEN RAISE EXCEPTION 'execution_directory_busy';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER linux_pool_challenges_guard BEFORE INSERT OR UPDATE OR DELETE ON linux_pool_challenges FOR EACH ROW EXECUTE FUNCTION linux_pool_history_guard();
CREATE TRIGGER linux_pool_attestations_guard BEFORE INSERT OR UPDATE OR DELETE ON linux_pool_attestations FOR EACH ROW EXECUTE FUNCTION linux_pool_history_guard();
INSERT INTO schema_version(version,description,applied_at) VALUES('505','Linux池nonce验收与pending授权CAS，不开放执行',now()) ON CONFLICT(version) DO NOTHING;
