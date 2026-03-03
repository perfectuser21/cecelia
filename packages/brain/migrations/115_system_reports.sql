-- Migration 115: 添加 system_reports 表
-- 用于存储定时生成的系统简报（48h 简报自动化调度集成）
-- 表结构：type（简报类型）, content（内容 JSONB）, metadata（元数据 JSONB）, created_at（生成时间）

CREATE TABLE IF NOT EXISTS system_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_reports_created_at ON system_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_reports_type_created ON system_reports(type, created_at DESC);

INSERT INTO schema_version (version, description)
VALUES ('115', 'Add system_reports table for 48h periodic reports')
ON CONFLICT (version) DO NOTHING;
