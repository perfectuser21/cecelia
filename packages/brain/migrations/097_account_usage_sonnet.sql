-- Migration 097: account_usage_cache 新增 seven_day_sonnet_pct 和 seven_day_resets_at
-- 目的：支持 Dashboard 显示 7d Sonnet 专属用量和各周期重置时间

ALTER TABLE account_usage_cache
  ADD COLUMN IF NOT EXISTS seven_day_sonnet_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seven_day_resets_at   TIMESTAMPTZ;
