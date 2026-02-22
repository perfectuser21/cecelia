-- Migration 046: bottleneck_scans table
-- 记录 Brain 识别的系统瓶颈扫描结果
-- Created: 2026-02-22 (schema sync — table was created by external agent)

-- Update schema version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('046', 'Create bottleneck_scans table', NOW())
ON CONFLICT (version) DO NOTHING;

-- Create bottleneck_scans table (idempotent)
CREATE TABLE IF NOT EXISTS bottleneck_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type VARCHAR(50) NOT NULL,
  bottleneck_area VARCHAR(100),
  severity VARCHAR(20) DEFAULT 'medium',
  details JSONB DEFAULT '{}',
  recommendations JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
