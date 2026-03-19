-- 162: 创建 content_topics 表（选题+文案自动化 Initiative）
--
-- 存储 AI 生成的选题建议，每条包含：标题、钩子句、文案草稿、AI评分、状态管理
-- 状态：pending（待确认）/ adopted（已采用）/ skipped（已跳过）

CREATE TABLE IF NOT EXISTS content_topics (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT          NOT NULL,
  hook             TEXT,
  body_draft       TEXT,
  target_platforms TEXT[]        DEFAULT '{}',
  ai_score         NUMERIC(3,1),
  score_reason     TEXT,
  status           TEXT          NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'adopted', 'skipped')),
  account_profile  JSONB,
  generated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  adopted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_topics_status ON content_topics (status);
CREATE INDEX IF NOT EXISTS idx_content_topics_created_at ON content_topics (created_at DESC);
