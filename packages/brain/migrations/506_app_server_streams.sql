-- 仅持久化流许可身份，不保存传输凭证、RPC正文或模型认证。
CREATE TABLE app_server_streams (
 id UUID PRIMARY KEY,
 reservation_id UUID NOT NULL UNIQUE REFERENCES app_server_generations(reservation_id) ON DELETE RESTRICT,
 prepare_deadline TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (prepare_deadline > created_at AND prepare_deadline <= created_at + interval '10 seconds')
);
CREATE FUNCTION guard_app_server_stream_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'appserver_stream_identity_immutable';
END $$;
CREATE TRIGGER app_server_stream_identity BEFORE UPDATE OR DELETE ON app_server_streams
 FOR EACH ROW EXECUTE FUNCTION guard_app_server_stream_identity();
INSERT INTO schema_version(version,description,applied_at)
 VALUES('506','app-server一次性流许可持久身份，数据面不经Brain',now()) ON CONFLICT(version) DO NOTHING;
