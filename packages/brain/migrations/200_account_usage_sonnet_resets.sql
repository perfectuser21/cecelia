-- Migration 199: account_usage_cache 新增 seven_day_sonnet_resets_at
-- 目的：存储 Sonnet 专属 7d 窗口的独立重置时间（与 seven_day_resets_at 不同）

ALTER TABLE account_usage_cache
  ADD COLUMN IF NOT EXISTS seven_day_sonnet_resets_at TIMESTAMPTZ;
