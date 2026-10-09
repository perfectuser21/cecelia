-- 新客户端以真实发生位置区分调用；旧数据与旧客户端保留原键，不猜测历史位置。
BEGIN;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS occurrence_key text;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS payload_sha256 text;
ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_occurrence_payload_check;
ALTER TABLE spans ADD CONSTRAINT spans_occurrence_payload_check CHECK (
  (occurrence_key IS NULL AND payload_sha256 IS NULL) OR
  (occurrence_key IS NOT NULL AND length(btrim(occurrence_key))>0
    AND payload_sha256 IS NOT NULL AND payload_sha256 ~ '^[0-9a-f]{64}$')
);
-- 限定当前schema，隔离测试不能误删public索引。
DO $$ BEGIN EXECUTE format('DROP INDEX IF EXISTS %I.uq_spans_idem', current_schema()); END $$;
CREATE UNIQUE INDEX uq_spans_idem ON spans(run_id,(COALESCE(step_id,activity_id,enabler_id)),started_at)
  WHERE occurrence_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_spans_occurrence ON spans(run_id,occurrence_key)
  WHERE occurrence_key IS NOT NULL;
COMMENT ON COLUMN spans.occurrence_key IS '上报者冻结的真实发生位置与重试身份；重传复用、再次执行新建；NULL=旧幂等协议';
COMMENT ON COLUMN spans.payload_sha256 IS 'Brain对规范化持久字段计算的SHA256；同run/occurrence异内容409，不覆盖原事实';
INSERT INTO schema_version(version,description) VALUES('514','Span发生位置幂等、服务端摘要及旧客户端partial索引兼容') ON CONFLICT(version) DO NOTHING;
COMMIT;
