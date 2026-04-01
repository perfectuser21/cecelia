-- Migration 209: content_topics 表创建 + 新增 source 字段
-- 区分 AI 自动选题（ai_daily_selection）vs 手动录入（manual_capture）

-- 若 content_topics 不存在则创建（之前为手动建表，无 migration）
CREATE TABLE IF NOT EXISTS content_topics (
  id            uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  title         TEXT NOT NULL,
  hook          TEXT,
  body_draft    TEXT,
  target_platforms TEXT[],
  ai_score      NUMERIC(4,1),
  score_reason  TEXT,
  status        VARCHAR(20) DEFAULT 'pending',
  account_profile TEXT,
  generated_at  TIMESTAMPTZ,
  adopted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE content_topics ADD COLUMN IF NOT EXISTS source VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_content_topics_source
  ON content_topics (source);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('209', 'content_topics 表创建（幂等）+ 新增 source 字段用于区分 AI 选题与手动录入', NOW())
ON CONFLICT (version) DO NOTHING;
