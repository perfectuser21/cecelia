-- Migration 115: 创建 system_reports 表
-- 用于存储 48h 自动生成的系统简报记录

CREATE TABLE IF NOT EXISTS system_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_type VARCHAR(50) NOT NULL DEFAULT '48h_summary',
  content JSONB NOT NULL DEFAULT '{}',
  pushed_to_dashboard BOOLEAN DEFAULT false,
  pushed_to_notion BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_generated_at ON system_reports(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_type ON system_reports(report_type);

INSERT INTO schema_version (version, description)
VALUES ('115', 'Add system_reports table for 48h automated briefing')
ON CONFLICT (version) DO NOTHING;
