-- Migration 228: account_usage_cache 添加 auth 失败熔断字段
-- 背景：auth 失败（401）时需临时排除该账号，防止级联 quarantine
-- 类比 is_spending_capped / spending_cap_resets_at

ALTER TABLE account_usage_cache
  ADD COLUMN IF NOT EXISTS is_auth_failed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_fail_resets_at timestamp with time zone;

-- schema version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('228', 'account_usage_cache: add is_auth_failed / auth_fail_resets_at', NOW())
ON CONFLICT (version) DO NOTHING;
