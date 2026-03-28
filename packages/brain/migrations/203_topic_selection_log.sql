-- Migration 203: topic_selection_log 表
-- 记录每日 AI 选题历史，用于 7 日去重和选题质量追踪

CREATE TABLE IF NOT EXISTS topic_selection_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selected_date DATE NOT NULL,
  keyword       TEXT NOT NULL,
  content_type  VARCHAR(100) NOT NULL DEFAULT 'solo-company-case',
  title_candidates JSONB,
  hook          TEXT,
  why_hot       TEXT,
  priority_score NUMERIC(4,3),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按日期查询（去重窗口）
CREATE INDEX IF NOT EXISTS idx_topic_selection_log_date
  ON topic_selection_log (selected_date DESC);

-- 索引：按关键词查询
CREATE INDEX IF NOT EXISTS idx_topic_selection_log_keyword
  ON topic_selection_log (keyword);

-- 记录 schema 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('203', 'topic_selection_log 表 - 每日选题历史去重', NOW())
ON CONFLICT (version) DO NOTHING;
