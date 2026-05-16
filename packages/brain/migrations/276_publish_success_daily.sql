-- Migration: 276_publish_success_daily
-- Purpose: 每日发布成功率快照表，供趋势分析和历史回溯使用
--
-- 设计：
--   1. (platform, date) UNIQUE — 每平台每天一行，支持幂等 upsert
--   2. success_rate NUMERIC(5,2) — 精度到 0.01%，值域 [0, 100]
--   3. Brain tick 通过 publish-monitor.js 的 writeStats 写入

BEGIN;

CREATE TABLE IF NOT EXISTS publish_success_daily (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     VARCHAR(64) NOT NULL,
  date         DATE        NOT NULL,
  total        INT         NOT NULL DEFAULT 0,
  completed    INT         NOT NULL DEFAULT 0,
  failed       INT         NOT NULL DEFAULT 0,
  success_rate NUMERIC(5,2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_publish_success_daily_platform_date UNIQUE (platform, date)
);

-- 按日期降序查趋势（主查询路径）
CREATE INDEX IF NOT EXISTS idx_publish_success_daily_date
  ON publish_success_daily(date DESC);

-- 按平台过滤
CREATE INDEX IF NOT EXISTS idx_publish_success_daily_platform
  ON publish_success_daily(platform, date DESC);

INSERT INTO schema_version (version, description)
VALUES ('276', 'publish_success_daily 表 — 每日每平台发布成功率快照');

COMMIT;
