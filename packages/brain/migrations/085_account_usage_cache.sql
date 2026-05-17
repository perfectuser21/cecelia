-- Migration 085: account_usage_cache
-- Claude Max 账号用量缓存表，用于调度时选择用量最低的账号

CREATE TABLE IF NOT EXISTS account_usage_cache (
  account_id    TEXT        PRIMARY KEY,
  five_hour_pct FLOAT       NOT NULL DEFAULT 0,
  seven_day_pct FLOAT       NOT NULL DEFAULT 0,
  resets_at     TIMESTAMPTZ,
  extra_used    BOOLEAN     NOT NULL DEFAULT FALSE,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE account_usage_cache IS 'Claude Max 账号5小时/7天用量缓存，10分钟 TTL';
COMMENT ON COLUMN account_usage_cache.five_hour_pct IS '5小时窗口用量百分比 (0-100)';
COMMENT ON COLUMN account_usage_cache.seven_day_pct IS '本周用量百分比 (0-100)';
COMMENT ON COLUMN account_usage_cache.resets_at IS '5小时窗口重置时间';
COMMENT ON COLUMN account_usage_cache.extra_used IS '是否已超额使用 extra usage';
COMMENT ON COLUMN account_usage_cache.fetched_at IS '最后从 Anthropic API 获取时间';

INSERT INTO schema_version (version) VALUES ('085') ON CONFLICT DO NOTHING;
