-- Migration 064: Fix bottleneck_scans schema
-- 为 bottleneck_scans 添加新代码期望的列
-- 原始表由外部 agent 创建，列名与 migration 046 期望的不同
-- Created: 2026-02-23

ALTER TABLE bottleneck_scans
  ADD COLUMN IF NOT EXISTS scan_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS bottleneck_area VARCHAR(100),
  ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recommendations JSONB DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_bottleneck_scans_scan_type ON bottleneck_scans(scan_type);

-- 旧列改为可空（新代码使用 scan_type 等新列，不填写旧列）
ALTER TABLE bottleneck_scans ALTER COLUMN bottleneck_type DROP NOT NULL;
ALTER TABLE bottleneck_scans ALTER COLUMN affected_component DROP NOT NULL;
ALTER TABLE bottleneck_scans ALTER COLUMN description DROP NOT NULL;
ALTER TABLE bottleneck_scans ALTER COLUMN metrics SET DEFAULT '{}'::jsonb;

-- Insert schema version
INSERT INTO schema_version (version, description)
VALUES ('064', 'Fix bottleneck_scans schema: add scan_type, bottleneck_area, details, recommendations')
ON CONFLICT (version) DO NOTHING;
