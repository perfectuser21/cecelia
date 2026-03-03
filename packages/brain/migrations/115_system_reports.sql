-- Migration 115: system_reports 表
-- 用于存储 Cortex 生成的系统简报（48h 定时触发）
-- PRD: 48h 简报自动化调度集成 - PR2

CREATE TABLE IF NOT EXISTS system_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  summary TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  time_range_hours INTEGER NOT NULL DEFAULT 48,
  report_type VARCHAR(50) NOT NULL DEFAULT 'system_briefing',
  generated_by VARCHAR(50) NOT NULL DEFAULT 'cortex',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS system_reports_created_at_idx ON system_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS system_reports_report_type_idx ON system_reports(report_type);

-- Update schema version
INSERT INTO schema_version (version, description)
VALUES ('115', 'system_reports table for cortex 48h briefing')
ON CONFLICT (version) DO NOTHING;
