-- Migration 207: 发布后数据回收统计表
-- 内容飞轮 I3：content_publish 完成 4 小时后，自动触发 scraper 采集指标

CREATE TABLE IF NOT EXISTS pipeline_publish_stats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id      UUID NOT NULL,
  publish_task_id  UUID NOT NULL,
  platform         VARCHAR(64) NOT NULL,
  views            BIGINT DEFAULT 0,
  likes            BIGINT DEFAULT 0,
  comments         BIGINT DEFAULT 0,
  shares           BIGINT DEFAULT 0,
  scraped_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_publish_stats_pipeline_id
  ON pipeline_publish_stats(pipeline_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_publish_stats_scraped_at
  ON pipeline_publish_stats(scraped_at DESC);
