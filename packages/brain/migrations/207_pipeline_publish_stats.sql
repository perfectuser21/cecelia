-- Migration 207: 创建 pipeline_publish_stats 表（发布后数据回收）
CREATE TABLE IF NOT EXISTS pipeline_publish_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID,
  publish_task_id UUID,
  platform TEXT NOT NULL,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (pipeline_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_publish_stats_pipeline_id ON pipeline_publish_stats(pipeline_id);
