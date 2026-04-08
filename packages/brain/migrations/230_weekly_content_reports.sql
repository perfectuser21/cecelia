-- Migration 230: 周报聚合表
-- 数据闭环 v1：每周内容运营数据自动汇总
-- 聚合来源：content_analytics（平台采集数据）

CREATE TABLE IF NOT EXISTS weekly_content_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start  DATE NOT NULL,                -- 周起始日（周一）
  period_end    DATE NOT NULL,                -- 周结束日（周日）
  week_label    VARCHAR(32) NOT NULL,         -- 如 "2026-W14"
  content       JSONB NOT NULL DEFAULT '{}', -- 周报正文（见下方结构说明）
  metadata      JSONB NOT NULL DEFAULT '{}', -- 生成元数据（生成时间、数据行数等）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(week_label)
);

-- content JSONB 结构说明：
-- {
--   "summary": { "total_pieces": N, "total_views": N, "total_likes": N, "total_comments": N, "total_shares": N },
--   "by_platform": [ { "platform": "douyin", "pieces": N, "views": N, "likes": N, "comments": N, "shares": N } ],
--   "top_content": [ { "platform": "...", "title": "...", "views": N, "likes": N } ],
--   "vs_last_week": { "views_growth_pct": N, "likes_growth_pct": N, "pieces_growth_pct": N }
-- }

CREATE INDEX IF NOT EXISTS idx_weekly_content_reports_period
  ON weekly_content_reports(period_start DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_content_reports_week_label
  ON weekly_content_reports(week_label);
