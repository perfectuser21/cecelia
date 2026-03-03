-- Migration 115: reports 表（系统简报定时生成）
-- 每 48 小时自动生成一次系统简报，推送到 Notion

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,                          -- 'system_brief'
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content JSONB,                                      -- 简报内容（结构化）
  status VARCHAR(20) NOT NULL DEFAULT 'generated',    -- generated / pushed / failed
  notion_id VARCHAR(255),                             -- Notion 页面 ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_type_generated_at ON reports (type, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);

INSERT INTO schema_version (version, description)
VALUES ('115', 'reports table for 48h system brief scheduling')
ON CONFLICT (version) DO NOTHING;
