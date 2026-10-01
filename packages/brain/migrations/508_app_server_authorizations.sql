-- Mac 保留原执行版本；聊天授权必须有独立证据，不能借用 legacy 导入。
CREATE TABLE app_server_authorizations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 machine_registry_id UUID NOT NULL REFERENCES execution_nodes(machine_registry_id),
 node_version_id UUID NOT NULL,
 FOREIGN KEY(machine_registry_id,node_version_id) REFERENCES execution_node_versions(machine_registry_id,id),
 grant_id UUID NOT NULL UNIQUE,
 FOREIGN KEY(grant_id,node_version_id) REFERENCES execution_grants(id,node_version_id) DEFERRABLE INITIALLY DEFERRED,
 evidence_task_id UUID NOT NULL UNIQUE REFERENCES tasks(id),
 home JSONB NOT NULL, worker_id TEXT NOT NULL, worker_boot_id UUID NOT NULL,
 nonce UUID NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','accepted','active','revoked')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 challenge_expires_at TIMESTAMPTZ NOT NULL, authorization_expires_at TIMESTAMPTZ NOT NULL,
 evidence JSONB, accepted_at TIMESTAMPTZ, activated_at TIMESTAMPTZ,
 CHECK((home->>'homeKey' ~ '^[a-f0-9]{64}$') IS TRUE),
 CHECK((home->>'configDigest' ~ '^[a-f0-9]{64}$') IS TRUE),
 CHECK(challenge_expires_at>created_at AND challenge_expires_at<=created_at+interval '10 minutes'),
 CHECK(authorization_expires_at>created_at AND authorization_expires_at<=created_at+interval '24 hours'),
 CHECK((evidence IS NULL AND accepted_at IS NULL) OR
  (evidence IS NOT NULL AND accepted_at IS NOT NULL AND (evidence->>'nonce'=nonce::text) IS TRUE
   AND (evidence->>'worker_boot_id'=worker_boot_id::text) IS TRUE
   AND (evidence->>'config_digest'=home->>'configDigest') IS TRUE
   AND (evidence->>'cleanup_confirmed'='true') IS TRUE)),
 CHECK(state NOT IN ('accepted','active') OR evidence IS NOT NULL)
);
CREATE INDEX app_server_authorizations_home ON app_server_authorizations((home->>'homeKey'),created_at DESC);
-- 续验创建新授权，撤销历史永久保留；其他执行面维持原来的唯一语义。
DO $$ DECLARE item RECORD; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='execution_grants'::regclass AND contype='u'
  AND pg_get_constraintdef(oid)='UNIQUE (node_version_id, surface, provider, account_id, repo_scope, profile_id)'
 LOOP EXECUTE format('ALTER TABLE execution_grants DROP CONSTRAINT %I',item.conname); END LOOP;
END $$;
CREATE UNIQUE INDEX execution_non_chat_grant_identity ON execution_grants(node_version_id,surface,provider,account_id,repo_scope,profile_id) WHERE surface<>'app_server';
CREATE UNIQUE INDEX execution_live_chat_grant_identity ON execution_grants(node_version_id,surface,provider,account_id,repo_scope,profile_id) WHERE surface='app_server' AND state IN ('pending','active');
CREATE FUNCTION app_server_authorization_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE machine TEXT;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'appserver_authorization_history_immutable';END IF;
 IF TG_OP='INSERT' AND (NEW.state<>'prepared' OR NEW.evidence IS NOT NULL OR NEW.accepted_at IS NOT NULL OR NEW.activated_at IS NOT NULL) THEN RAISE EXCEPTION 'appserver_authorization_history_immutable';END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.state<>OLD.state AND NEW.state IN ('accepted','active') AND (NEW.challenge_expires_at<=clock_timestamp() OR NEW.authorization_expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'appserver_canary_expired';END IF;
  IF (to_jsonb(NEW)-ARRAY['state','evidence','accepted_at','activated_at'])<>(to_jsonb(OLD)-ARRAY['state','evidence','accepted_at','activated_at'])
   OR (OLD.evidence IS NOT NULL AND (NEW.evidence IS DISTINCT FROM OLD.evidence OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at))
   OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at)
   OR (OLD.state='revoked' AND NEW.state<>'revoked')
   OR (OLD.state='active' AND NEW.state NOT IN ('active','revoked'))
   OR (OLD.state='accepted' AND NEW.state NOT IN ('accepted','active','revoked'))
   OR (OLD.state='prepared' AND NEW.state='active') THEN RAISE EXCEPTION 'appserver_authorization_history_immutable';END IF;
 END IF;
 SELECT canonical_id INTO machine FROM execution_nodes WHERE machine_registry_id=NEW.machine_registry_id;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('harness_attempt_machine:'||machine,0)) THEN RAISE EXCEPTION 'execution_directory_busy';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER app_server_authorization_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app_server_authorizations FOR EACH ROW EXECUTE FUNCTION app_server_authorization_history_guard();
CREATE FUNCTION app_server_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence app_server_authorizations%ROWTYPE;
BEGIN
 IF NEW.surface<>'app_server' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND (OLD.state='revoked' AND NEW.state<>'revoked' OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN RAISE EXCEPTION 'appserver_grant_history_immutable';END IF;
 -- 任何已有授权均可收回，清理不依赖在线配置或未过期证据。
 IF NEW.state='revoked' THEN RETURN NEW;END IF;
 SELECT * INTO evidence FROM app_server_authorizations WHERE grant_id=NEW.id;
 IF evidence.id IS NULL OR NEW.node_version_id<>evidence.node_version_id OR NEW.provenance<>'app_server_canary'
  OR NEW.evidence_task_id IS DISTINCT FROM evidence.evidence_task_id
  OR NEW.provider IS DISTINCT FROM evidence.home->>'provider' OR NEW.account_id IS DISTINCT FROM evidence.home->>'account'
  OR NEW.profile_id IS DISTINCT FROM evidence.home->>'profile' OR NEW.repo_scope IS DISTINCT FROM ARRAY[evidence.home->>'repo']
  OR NEW.expires_at IS DISTINCT FROM evidence.authorization_expires_at OR NEW.expires_at<=clock_timestamp()
  OR NOT EXISTS(SELECT 1 FROM execution_nodes n JOIN execution_node_versions v ON v.id=n.current_version_id
    JOIN system_registry r ON r.id=n.machine_registry_id
    WHERE n.machine_registry_id=evidence.machine_registry_id AND v.id=evidence.node_version_id
     AND v.state='active' AND v.platform='darwin' AND v.identity_mode='legacy-v1' AND v.worker_id=evidence.worker_id
     AND r.type='machine' AND r.status='active'
     AND COALESCE(r.metadata->>'role','') NOT IN ('scheduler','scheduler_only')
     AND COALESCE(r.metadata->>'scheduler_only','false')<>'true')
 THEN RAISE EXCEPTION 'appserver_authorization_required';END IF;
 IF NEW.state='pending' AND (evidence.state<>'prepared' OR evidence.challenge_expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'appserver_canary_expired';END IF;
 IF NEW.state='active' AND (TG_OP='INSERT' OR OLD.state<>'active') AND evidence.challenge_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'appserver_canary_expired';END IF;
 IF NEW.state='active' AND (evidence.state NOT IN ('accepted','active') OR evidence.evidence IS NULL
   OR NOT EXISTS(SELECT 1 FROM tasks WHERE id=evidence.evidence_task_id AND status='completed'))
 THEN RAISE EXCEPTION 'appserver_evidence_required';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER app_server_grant_guard BEFORE INSERT OR UPDATE ON execution_grants FOR EACH ROW EXECUTE FUNCTION app_server_grant_guard();
-- 接受证据、完成任务和激活在同一事务；提交时两张表必须一致。
CREATE FUNCTION app_server_authorization_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE auth_record app_server_authorizations%ROWTYPE; grant_state TEXT;
BEGIN
 IF TG_TABLE_NAME='execution_grants' THEN
  IF NEW.surface<>'app_server' THEN RETURN NULL;END IF;
  SELECT * INTO auth_record FROM app_server_authorizations WHERE grant_id=NEW.id;
 ELSE SELECT * INTO auth_record FROM app_server_authorizations WHERE id=NEW.id;END IF;
 IF auth_record.id IS NULL THEN RETURN NULL;END IF;
 SELECT state INTO grant_state FROM execution_grants WHERE id=auth_record.grant_id;
 IF (grant_state='active' AND auth_record.state<>'active') OR (auth_record.state='revoked' AND grant_state<>'revoked')
  OR (auth_record.state='active' AND grant_state='pending')
  OR (auth_record.state='active' AND auth_record.activated_at IS NULL)
  OR (auth_record.state IN ('prepared','accepted') AND auth_record.activated_at IS NOT NULL)
 THEN RAISE EXCEPTION 'appserver_authorization_state_mismatch';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER app_server_authorization_commit_guard AFTER INSERT OR UPDATE ON app_server_authorizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_server_authorization_commit_guard();
CREATE CONSTRAINT TRIGGER app_server_grant_commit_guard AFTER INSERT OR UPDATE ON execution_grants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_server_authorization_commit_guard();
INSERT INTO schema_version(version,description,applied_at) VALUES('508','Mac聊天独立验收证据及不可复活精确授权',now()) ON CONFLICT(version) DO NOTHING;
