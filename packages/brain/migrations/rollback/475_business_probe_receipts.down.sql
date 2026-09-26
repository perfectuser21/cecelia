-- 回滚 475：回执表退回 374 单值 executor_kind + 原 verdict_chk。
-- 业务探针回执行在旧约束下非法，必须先删（表有 append-only 触发器，DELETE 需临时禁用）。
BEGIN;
ALTER TABLE journey_assertion_receipts DISABLE TRIGGER trg_journey_assertion_receipts_append_only;
DELETE FROM journey_assertion_receipts WHERE executor_kind = 'business_probe_runner';
ALTER TABLE journey_assertion_receipts ENABLE TRIGGER trg_journey_assertion_receipts_append_only;

ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipts_executor_kind_chk;
ALTER TABLE journey_assertion_receipts
  ADD CONSTRAINT journey_assertion_receipts_executor_kind_check
  CHECK (executor_kind = 'brain_assertion_runner');

ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipt_verdict_chk;
ALTER TABLE journey_assertion_receipts
  ADD CONSTRAINT journey_assertion_receipt_verdict_chk
  CHECK (
    (
      verdict = 'PASS'
      AND exit_code = 0
      AND source_sha IS NOT NULL
      AND source_sha ~ '^[0-9a-f]{40}$'
      AND machine_id IS NOT NULL
      AND btrim(machine_id) <> ''
      AND output_digest IS NOT NULL
      AND output_digest ~ '^[0-9a-f]{64}$'
      AND scenario_count > 0
      AND scenario_evidence <> '{}'::jsonb
    )
    OR (verdict = 'FAIL' AND exit_code <> 0)
  ) NOT VALID;

DELETE FROM schema_version WHERE version = '475';
COMMIT;
