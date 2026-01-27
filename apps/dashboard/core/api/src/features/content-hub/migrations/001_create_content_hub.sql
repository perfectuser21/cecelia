-- Migration: Create VPS Content Hub tables
-- Version: 1.0.0
-- Date: 2026-01-27

-- 1. Create content table (内容表)
CREATE TABLE IF NOT EXISTS content (
  id SERIAL PRIMARY KEY,
  content_id VARCHAR(50) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  type VARCHAR(20),
  images TEXT[],
  video_url TEXT,
  cover_image TEXT,
  status VARCHAR(20) DEFAULT 'draft',
  scheduled_time TIMESTAMP,
  publish_date DATE,
  source VARCHAR(20) DEFAULT 'dashboard',
  notion_page_id VARCHAR(100),
  tags TEXT[],
  category VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_content_id ON content(content_id);
CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
CREATE INDEX IF NOT EXISTS idx_content_publish_date ON content(publish_date);
CREATE INDEX IF NOT EXISTS idx_content_source ON content(source);

-- 2. Create content_platforms table (发布记录表)
CREATE TABLE IF NOT EXISTS content_platforms (
  id SERIAL PRIMARY KEY,
  content_id VARCHAR(50) REFERENCES content(content_id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL,
  post_id VARCHAR(100),
  post_url TEXT,
  video_url TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  published_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(content_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_content_platforms_content_id ON content_platforms(content_id);
CREATE INDEX IF NOT EXISTS idx_content_platforms_platform ON content_platforms(platform);
CREATE INDEX IF NOT EXISTS idx_content_platforms_status ON content_platforms(status);

-- 3. Extend content_items table with content_id
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS content_id VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_content_items_content_id ON content_items(content_id);

-- 4. Add foreign key constraint (optional, for data integrity)
-- Note: We don't add FK constraint to allow flexibility (content_id can be NULL for unmatched scraped data)
-- If needed in the future: ALTER TABLE content_items ADD CONSTRAINT fk_content_items_content_id FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE SET NULL;

-- 5. Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_content_updated_at BEFORE UPDATE ON content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_platforms_updated_at BEFORE UPDATE ON content_platforms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
