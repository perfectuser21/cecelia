-- 回滚 478：摘掉验证层三表的 Notion 投影接线（记账列 / 触发器 / 登记）。
-- 记账列无业务依赖可直接删；回执触发器还原 374 原样（一切 UPDATE/DELETE 拒）；
-- journey_step_links 摘 updated_at 触发器与列；注册表删两行（Notion 库本身不动，重跑 478 即接回）。
BEGIN;

DELETE FROM notion_projection_map WHERE brain_table IN ('step_probes', 'journey_assertion_receipts');

DROP TRIGGER IF EXISTS trg_touch_journey_step_links_updated_at ON journey_step_links;
DROP FUNCTION IF EXISTS touch_journey_step_links_updated_at();
ALTER TABLE journey_step_links DROP COLUMN IF EXISTS updated_at;

CREATE OR REPLACE FUNCTION prevent_journey_assertion_receipt_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'journey_assertion_receipts is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE journey_assertion_receipts DROP COLUMN IF EXISTS notion_id;
ALTER TABLE journey_assertion_receipts DROP COLUMN IF EXISTS notion_synced_at;
ALTER TABLE journey_assertion_receipts DROP COLUMN IF EXISTS notion_digest;

ALTER TABLE step_probes DROP COLUMN IF EXISTS notion_id;
ALTER TABLE step_probes DROP COLUMN IF EXISTS notion_synced_at;
ALTER TABLE step_probes DROP COLUMN IF EXISTS notion_digest;

DELETE FROM schema_version WHERE version = '478';
COMMIT;
