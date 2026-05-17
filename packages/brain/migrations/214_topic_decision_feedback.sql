-- Migration 214: 选题决策反馈表
-- 数据闭环 I4：每周将发布内容的互动数据回归到话题维度，形成选题热度排行
-- 高热话题注入下次 topic-selector Prompt，实现「生成→发布→数据→选题」完整闭环

CREATE TABLE IF NOT EXISTS topic_decision_feedback (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_key              VARCHAR(10) NOT NULL,          -- 格式 YYYY-WNN（ISO 周）
  topic_keyword         TEXT NOT NULL,                 -- 话题关键词
  heat_score            NUMERIC(6,2) DEFAULT 0,        -- 综合热度分 0-100
  total_views           BIGINT DEFAULT 0,
  total_likes           BIGINT DEFAULT 0,
  total_comments        BIGINT DEFAULT 0,
  total_shares          BIGINT DEFAULT 0,
  publish_count         INT DEFAULT 0,                 -- 本周该话题发布次数
  recommended_next_week BOOLEAN DEFAULT FALSE,         -- 是否已推荐为下周方向
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 唯一约束：每周每个话题只有一条记录
CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_decision_feedback_week_keyword
  ON topic_decision_feedback (week_key, topic_keyword);

-- 按周查询（生成周报时）
CREATE INDEX IF NOT EXISTS idx_topic_decision_feedback_week
  ON topic_decision_feedback (week_key DESC);

-- 按热度排序（注入选题 Prompt 时）
CREATE INDEX IF NOT EXISTS idx_topic_decision_feedback_heat
  ON topic_decision_feedback (heat_score DESC, week_key DESC);

-- 记录 schema 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('214', 'topic_decision_feedback 表 - 选题热度反馈闭环', NOW())
ON CONFLICT (version) DO NOTHING;
