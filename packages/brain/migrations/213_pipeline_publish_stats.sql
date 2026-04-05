-- Migration 213: 发布后数据回收统计表
-- 修复：Migration 207 文件被错误重命名为 pipeline_publish_stats，但 207 实际执行的是 brain_health_checks
-- 本 migration 补充创建 pipeline_publish_stats 表

CREATE TABLE IF NOT EXISTS pipeline_publish_stats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id      UUID,
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

CREATE INDEX IF NOT EXISTS idx_pipeline_publish_stats_publish_task_id
  ON pipeline_publish_stats(publish_task_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_publish_stats_scraped_at
  ON pipeline_publish_stats(scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_publish_stats_platform
  ON pipeline_publish_stats(platform, scraped_at DESC);
