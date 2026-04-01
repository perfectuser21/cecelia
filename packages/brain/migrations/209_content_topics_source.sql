-- Migration 209: content_topics 新增 source 字段
-- 区分 AI 自动选题（ai_daily_selection）vs 手动录入（manual_capture）

ALTER TABLE content_topics ADD COLUMN IF NOT EXISTS source VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_content_topics_source
  ON content_topics (source);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('209', 'content_topics 新增 source 字段用于区分 AI 选题与手动录入', NOW())
ON CONFLICT (version) DO NOTHING;
