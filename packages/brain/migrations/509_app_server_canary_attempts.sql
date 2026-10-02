-- 验收与普通聊天共用真实预算，只有两代受限验收；身份和历史禁止改写。
CREATE TABLE app_server_canary_attempts (
 authorization_id UUID NOT NULL REFERENCES app_server_authorizations(id),
 sequence_no INTEGER NOT NULL CHECK(sequence_no IN (1,2)),
 reservation_id UUID NOT NULL UNIQUE REFERENCES app_server_generations(reservation_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(authorization_id,sequence_no)
);
CREATE FUNCTION app_server_canary_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app_server_authorizations%ROWTYPE;r RECORD;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'appserver_canary_identity_immutable';END IF;
 SELECT * INTO a FROM app_server_authorizations WHERE id=NEW.authorization_id;
 SELECT c.*,g.home_key,g.request_key,h.config INTO r FROM capacity_reservations c
  JOIN app_server_generations g ON g.reservation_id=c.id JOIN app_server_homes h ON h.home_key=g.home_key WHERE c.id=NEW.reservation_id;
 IF a.id IS NULL OR r.id IS NULL OR a.state<>'prepared' OR a.challenge_expires_at<=clock_timestamp()
  OR r.owner_kind<>'app_server' OR r.policy_version<>'app-server-canary-v1' OR r.status<>'reserved'
  OR r.execution_version_id IS DISTINCT FROM a.node_version_id OR r.execution_grant_id IS DISTINCT FROM a.grant_id
  OR r.worker_id IS DISTINCT FROM a.worker_id OR r.worker_boot_id IS DISTINCT FROM a.worker_boot_id::text
  OR r.config IS DISTINCT FROM a.home OR r.home_key IS DISTINCT FROM a.home->>'homeKey'
  OR r.request_key IS DISTINCT FROM (CASE WHEN NEW.sequence_no=1 THEN a.nonce ELSE a.id END)
 THEN RAISE EXCEPTION 'appserver_canary_identity_mismatch';END IF;
 IF NEW.sequence_no=2 AND NOT EXISTS(SELECT 1 FROM app_server_canary_attempts previous JOIN capacity_reservations c ON c.id=previous.reservation_id
  WHERE previous.authorization_id=NEW.authorization_id AND previous.sequence_no=1 AND c.status='released' AND c.confirmed_receipt IS NOT NULL)
 THEN RAISE EXCEPTION 'appserver_canary_previous_cleanup_required';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER app_server_canary_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON app_server_canary_attempts FOR EACH ROW EXECUTE FUNCTION app_server_canary_attempt_guard();
INSERT INTO schema_version(version,description,applied_at) VALUES('509','两代受限聊天验收预约及不可改写身份',now()) ON CONFLICT(version) DO NOTHING;

CREATE TABLE app_server_canary_evidence (
 reservation_id UUID PRIMARY KEY REFERENCES app_server_canary_attempts(reservation_id),
 envelope JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE FUNCTION app_server_canary_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'appserver_canary_evidence_immutable';END $$;
CREATE TRIGGER app_server_canary_evidence_immutable BEFORE UPDATE OR DELETE ON app_server_canary_evidence FOR EACH ROW EXECUTE FUNCTION app_server_canary_evidence_immutable();

-- 调度状态不改写授权历史；续验链根的显式撤销单向生效。
CREATE TABLE app_server_authorization_jobs (
 authorization_id UUID PRIMARY KEY REFERENCES app_server_authorizations(id),
 root_authorization_id UUID NOT NULL REFERENCES app_server_authorizations(id),
 successor_id UUID UNIQUE REFERENCES app_server_authorizations(id),
 retired_for_renewal BOOLEAN NOT NULL DEFAULT false,
 explicitly_revoked BOOLEAN NOT NULL DEFAULT false,
 next_run_at TIMESTAMPTZ DEFAULT statement_timestamp(),
 last_error TEXT CHECK(length(last_error)<=160)
);
INSERT INTO app_server_authorization_jobs(authorization_id,root_authorization_id)
 SELECT id,id FROM app_server_authorizations;
CREATE FUNCTION app_server_authorization_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'appserver_authorization_job_immutable';END IF;
 IF TG_OP='UPDATE' AND (NEW.authorization_id<>OLD.authorization_id OR NEW.root_authorization_id<>OLD.root_authorization_id
  OR OLD.successor_id IS NOT NULL AND NEW.successor_id IS DISTINCT FROM OLD.successor_id
  OR OLD.retired_for_renewal AND NOT NEW.retired_for_renewal
  OR OLD.explicitly_revoked AND NOT NEW.explicitly_revoked)
 THEN RAISE EXCEPTION 'appserver_authorization_job_immutable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER app_server_authorization_job_guard BEFORE UPDATE OR DELETE ON app_server_authorization_jobs FOR EACH ROW EXECUTE FUNCTION app_server_authorization_job_guard();
