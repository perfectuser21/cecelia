-- Migration 477: journey_assertion_receipts 唯一键补 assertion_ref_snapshot（链 bf5088a3 棒3a-3，任务 5e9dffd2）
--
-- 病：409 建的唯一约束 journey_assertion_receipts_run_link_source_impact_key
--   = (run_id, journey_step_link_id, source_sha, impact_contract_hash) NULLS NOT DISTINCT。
--   业务探针回执（475 放行的 business_probe_runner）同 run 同格可有多条断言，且 source_sha /
--   impact_contract_hash 皆 NULL → NULLS NOT DISTINCT 把第二条起全判重复，ON CONFLICT DO NOTHING 静默吞掉。
--   09-27 生产实证：run social-keyword-leadgen-crontab-auto09262230__a1.delivery judged=3 只落 1 行，
--   videos_readback（FAIL warn）与 line_key_not_null 丢失——晨报「断言红灯」读回执表看不到 FAIL。
--
-- 修：唯一键四列 → 五列，补 assertion_ref_snapshot（业务探针 = probe:<key>，一条探针一个值）。
--   harness 行（brain_assertion_runner）一格一断言、assertion_ref_snapshot 固定 → 同 run 同格重复插入
--   仍去重，语义不变（pg 集成测试有断言）。
--   幂等：DROP CONSTRAINT/INDEX IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS。
--   assertion-receipts.js 两处 ON CONFLICT 列集同步改为五列。

ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipts_run_link_source_impact_key;
DROP INDEX IF EXISTS journey_assertion_receipts_run_link_source_impact_key;

CREATE UNIQUE INDEX IF NOT EXISTS journey_assertion_receipts_run_link_source_impact_ref_key
  ON journey_assertion_receipts (
    run_id, journey_step_link_id, source_sha, impact_contract_hash, assertion_ref_snapshot
  ) NULLS NOT DISTINCT;

COMMENT ON INDEX journey_assertion_receipts_run_link_source_impact_ref_key IS
  '回执唯一键（477）：run × 格 × 源 sha × 影响合同 hash × 断言引用；NULLS NOT DISTINCT——业务探针 sha/hash 为 NULL 时靠 assertion_ref_snapshot 区分同格多条探针。';

INSERT INTO schema_version (version, description)
VALUES ('477', 'journey_assertion_receipts 唯一键补 assertion_ref_snapshot：同 run 同格多条业务探针回执不再互吞（棒3a-3）')
ON CONFLICT (version) DO NOTHING;
