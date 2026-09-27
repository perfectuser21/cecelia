-- 回滚 477：回执表唯一键退回 409 四列 (run_id, journey_step_link_id, source_sha, impact_contract_hash)。
-- 五列键下已允许的"同 run 同格多条业务探针回执"在四列键下非法，必须先按四列键去重（保留 id 最小的一条）；
-- 表有 append-only 触发器，DELETE 需临时禁用（与 475 回滚同口径）。
BEGIN;
DROP INDEX IF EXISTS journey_assertion_receipts_run_link_source_impact_ref_key;

ALTER TABLE journey_assertion_receipts DISABLE TRIGGER trg_journey_assertion_receipts_append_only;
DELETE FROM journey_assertion_receipts r
 USING journey_assertion_receipts k
 WHERE r.run_id = k.run_id
   AND r.journey_step_link_id = k.journey_step_link_id
   AND r.source_sha IS NOT DISTINCT FROM k.source_sha
   AND r.impact_contract_hash IS NOT DISTINCT FROM k.impact_contract_hash
   AND r.id > k.id;
ALTER TABLE journey_assertion_receipts ENABLE TRIGGER trg_journey_assertion_receipts_append_only;

ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipts_run_link_source_impact_key;
ALTER TABLE journey_assertion_receipts
  ADD CONSTRAINT journey_assertion_receipts_run_link_source_impact_key
  UNIQUE NULLS NOT DISTINCT (
    run_id, journey_step_link_id, source_sha, impact_contract_hash
  );

DELETE FROM schema_version WHERE version = '477';
COMMIT;
