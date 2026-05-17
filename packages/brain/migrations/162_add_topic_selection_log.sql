-- Migration 162: 添加 topic_selection_log 表（每日内容选题日志）
-- 幂等设计，重复执行安全

CREATE TABLE IF NOT EXISTS topic_selection_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selected_date    DATE NOT NULL,
  keyword          TEXT NOT NULL,
  content_type     TEXT NOT NULL DEFAULT 'solo-company-case',
  title_candidates JSONB,
  hook             TEXT,
  why_hot          TEXT,
  priority_score   FLOAT,
  task_id          UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topic_log_date
  ON topic_selection_log(selected_date);

CREATE INDEX IF NOT EXISTS idx_topic_log_keyword
  ON topic_selection_log(keyword);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('162', 'add topic_selection_log table for daily AI topic generation tracking', NOW())
ON CONFLICT (version) DO NOTHING;
