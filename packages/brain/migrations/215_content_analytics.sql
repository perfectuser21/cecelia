-- Migration 215: 通用内容效果数据采集表
-- 数据闭环 KR：浏览/互动/转化指标时序存储
-- 与 pipeline_publish_stats（流水线专用）互补，支持任意内容的多次快照

CREATE TABLE IF NOT EXISTS content_analytics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     VARCHAR(64) NOT NULL,           -- douyin/xiaohongshu/weibo/wechat/kuaishou/toutiao/channels/zhihu
  content_id   VARCHAR(256),                   -- 平台侧内容 ID（可为空，初期只有标题）
  title        TEXT,                           -- 内容标题
  published_at TIMESTAMPTZ,                    -- 内容发布时间
  views        BIGINT NOT NULL DEFAULT 0,      -- 浏览/播放量
  likes        BIGINT NOT NULL DEFAULT 0,      -- 点赞/收藏数
  comments     BIGINT NOT NULL DEFAULT 0,      -- 评论数
  shares       BIGINT NOT NULL DEFAULT 0,      -- 转发/分享数
  clicks       BIGINT NOT NULL DEFAULT 0,      -- 点击数（部分平台有）
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- 采集时间（时序主键）
  source       VARCHAR(64) NOT NULL DEFAULT 'scraper',  -- scraper/api/manual
  pipeline_id  UUID,                           -- 关联流水线（可选）
  raw_data     JSONB NOT NULL DEFAULT '{}',    -- 原始字段备份
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 按平台 + 采集时间查询
CREATE INDEX IF NOT EXISTS idx_content_analytics_platform_collected
  ON content_analytics(platform, collected_at DESC);

-- 按内容 ID 查询历史快照
CREATE INDEX IF NOT EXISTS idx_content_analytics_content_id
  ON content_analytics(platform, content_id)
  WHERE content_id IS NOT NULL;

-- 按 pipeline_id 关联查询
CREATE INDEX IF NOT EXISTS idx_content_analytics_pipeline_id
  ON content_analytics(pipeline_id)
  WHERE pipeline_id IS NOT NULL;

-- 按采集时间范围扫描（周报 ROI 计算）
CREATE INDEX IF NOT EXISTS idx_content_analytics_collected_at
  ON content_analytics(collected_at DESC);
