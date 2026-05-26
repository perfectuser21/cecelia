-- Migration 280: Content Clips 采集表
-- 抖音/小红书内容采集记录

CREATE TABLE IF NOT EXISTS clips (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url           TEXT        NOT NULL,
  platform      TEXT        NOT NULL CHECK (platform IN ('douyin', 'xiaohongshu')),
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  title         TEXT,
  author        TEXT,
  author_id     TEXT,
  like_count    INTEGER,
  comment_count INTEGER,
  share_count   INTEGER,
  cover_url     TEXT,
  video_url     TEXT,
  transcript    TEXT,
  images        JSONB       DEFAULT '[]',
  raw_response  JSONB,
  error_msg     TEXT,
  requested_by  TEXT,
  retry_count   INTEGER     DEFAULT 0,
  metadata      JSONB       DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clips_url             ON clips (url);
CREATE INDEX IF NOT EXISTS idx_clips_platform_status        ON clips (platform, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_created_at             ON clips (created_at DESC);
