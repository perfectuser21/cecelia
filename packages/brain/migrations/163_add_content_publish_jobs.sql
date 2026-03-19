-- Migration 163: Add content_publish_jobs table
-- 发布任务队列：追踪 Brain 派发的每个多平台发布 job 的状态
-- 幂等设计，重复执行安全

-- 1. 创建 content_publish_jobs 表
CREATE TABLE IF NOT EXISTS content_publish_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform    TEXT NOT NULL,          -- douyin/kuaishou/xiaohongshu/toutiao/weibo/shipinhao/zhihu/wechat
  content_type TEXT NOT NULL,         -- video/image/article/idea
  payload     JSONB NOT NULL DEFAULT '{}',  -- { title, description, file_paths, cover_path, ... }
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending/running/success/failed
  task_id     UUID,                   -- 关联 Brain tasks.id（可选）
  error_message TEXT,
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 索引
CREATE INDEX IF NOT EXISTS content_publish_jobs_platform_idx ON content_publish_jobs (platform);
CREATE INDEX IF NOT EXISTS content_publish_jobs_status_idx ON content_publish_jobs (status);
CREATE INDEX IF NOT EXISTS content_publish_jobs_created_at_idx ON content_publish_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS content_publish_jobs_task_id_idx ON content_publish_jobs (task_id) WHERE task_id IS NOT NULL;

-- 3. 记录版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('163', 'add content_publish_jobs table for Brain-triggered multi-platform publish tracking', NOW())
ON CONFLICT (version) DO NOTHING;
