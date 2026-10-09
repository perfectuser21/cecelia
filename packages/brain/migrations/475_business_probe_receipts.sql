-- Migration 475: journey_assertion_receipts 放行 executor_kind='business_probe_runner'
--（棒3a 判定，任务 33aa2bc4，决策 702949b6 / 95e29afd / b56e37b4）
--
-- 374 把回执表钉死在 brain_assertion_runner（CI 跑断言、必带 source_sha/machine_id/output_digest）。
-- 业务探针判定（run.finished → step_probes 比对，step_probes 见 474）是另一种验证：证据是
-- observed/expected 值，没有代码 sha、没有执行机器、没有输出摘要——按 374 的 PASS 式子一行都写不进去。
--
-- 本迁移：
--   一、executor_kind CHECK 单值 → 两值（374 内联约束自动命名 journey_assertion_receipts_executor_kind_check）。
--   二、verdict_chk 按 executor_kind 分支：brain_assertion_runner 原式一字不动；
--       business_probe_runner 只要求 PASS ↔ exit_code=0 且 scenario_evidence 非空 / FAIL ↔ exit_code<>0。
--       NOT VALID 与 374 同口径（存量行不重验）。
--   三、合并闸（impact-contract/harness-gates.js）SQL 仍只认 brain_assertion_runner，业务探针回执不进合并闸。

ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipts_executor_kind_check;
ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipts_executor_kind_chk;
ALTER TABLE journey_assertion_receipts
  ADD CONSTRAINT journey_assertion_receipts_executor_kind_chk
  CHECK (executor_kind IN ('brain_assertion_runner', 'business_probe_runner'));

ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipt_verdict_chk;
ALTER TABLE journey_assertion_receipts
  ADD CONSTRAINT journey_assertion_receipt_verdict_chk
  CHECK (
    (
      executor_kind = 'brain_assertion_runner'
      AND (
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
      )
    )
    OR (
      executor_kind = 'business_probe_runner'
      AND (
        (verdict = 'PASS' AND exit_code = 0 AND scenario_evidence <> '{}'::jsonb)
        OR (verdict = 'FAIL' AND exit_code <> 0)
      )
    )
  ) NOT VALID;

INSERT INTO schema_version (version, description)
VALUES ('475', 'journey_assertion_receipts 放行 business_probe_runner：executor_kind 两值 + verdict_chk 按 executor_kind 分支（棒3a 判定）')
ON CONFLICT (version) DO NOTHING;
