-- Migration 217: LLM 算力消耗快照表
-- 每日定时将 account_usage_cache 快照写入，形成历史趋势
-- 供周报和选题引擎查询 LLM API 消耗情况
-- 注：216 已被 topic_suggestions 占用，本表使用 217

CREATE TABLE IF NOT EXISTS llm_usage_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   VARCHAR(64) NOT NULL,
  five_hour_pct DOUBLE PRECISION NOT NULL DEFAULT 0,    -- 5小时用量百分比
  seven_day_pct DOUBLE PRECISION NOT NULL DEFAULT 0,    -- 7天用量百分比
  seven_day_sonnet_pct DOUBLE PRECISION NOT NULL DEFAULT 0,  -- 7天 Sonnet 用量百分比
  is_spending_capped BOOLEAN NOT NULL DEFAULT false,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()       -- 快照时间
);

-- 按账号 + 时间查询
CREATE INDEX IF NOT EXISTS idx_llm_usage_snapshots_account_time
  ON llm_usage_snapshots(account_id, recorded_at DESC);

-- 按时间范围扫描（周报使用）
CREATE INDEX IF NOT EXISTS idx_llm_usage_snapshots_recorded_at
  ON llm_usage_snapshots(recorded_at DESC);

-- 记录 schema 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('217', 'llm_usage_snapshots 表 - 算力消耗历史快照', NOW())
ON CONFLICT (version) DO NOTHING;
