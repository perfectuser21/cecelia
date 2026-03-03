-- Migration 102: account_usage_cache 新增 spending cap 持久化字段
-- 目的：Brain 重启后仍能记住哪些账号处于 spending cap 状态

ALTER TABLE account_usage_cache
  ADD COLUMN IF NOT EXISTS is_spending_capped     BOOLEAN    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spending_cap_resets_at TIMESTAMPTZ;

COMMENT ON COLUMN account_usage_cache.is_spending_capped IS '账号是否处于 spending cap 状态（跨重启持久化）';
COMMENT ON COLUMN account_usage_cache.spending_cap_resets_at IS 'Spending cap 解除时间（NULL 表示未被 cap）';

INSERT INTO schema_version (version) VALUES ('102') ON CONFLICT DO NOTHING;
