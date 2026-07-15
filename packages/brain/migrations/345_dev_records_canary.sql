-- Migration 345: dev_records 加 is_canary 列
-- 金丝雀演习任务写入 dev_records 时标记，确保不污染统计

ALTER TABLE dev_records ADD COLUMN IF NOT EXISTS is_canary BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_dev_records_is_canary ON dev_records(is_canary) WHERE is_canary = TRUE;
