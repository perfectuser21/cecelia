-- Migration 128: 创建 alex_pages 表
-- Alex Pages 是 Alex（用户）的知识页面系统，存储结构化内容

CREATE TABLE IF NOT EXISTS alex_pages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  content_json JSONB NOT NULL DEFAULT '{}',
  area         TEXT,
  project      TEXT,
  tags         TEXT[] NOT NULL DEFAULT '{}',
  page_type    TEXT NOT NULL DEFAULT 'note',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按 area 过滤
CREATE INDEX IF NOT EXISTS idx_alex_pages_area ON alex_pages (area);

-- 索引：按 page_type 过滤
CREATE INDEX IF NOT EXISTS idx_alex_pages_page_type ON alex_pages (page_type);

-- 索引：按创建时间排序
CREATE INDEX IF NOT EXISTS idx_alex_pages_created_at ON alex_pages (created_at DESC);
