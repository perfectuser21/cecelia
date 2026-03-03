-- Migration 115: system_reports 表 — 48h 系统简报自动生成
-- 用于存储 Cecelia 定期生成的系统状态简报
-- tick.js 每次执行时检查是否需要生成新简报（间隔 48h）

CREATE TABLE IF NOT EXISTS system_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type VARCHAR(64) NOT NULL DEFAULT 'system_48h',
  content TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 按类型和生成时间索引，用于快速查询最新简报
CREATE INDEX IF NOT EXISTS idx_system_reports_type_generated
  ON system_reports (report_type, generated_at DESC);

COMMENT ON TABLE system_reports IS 'Cecelia 系统简报存储表，每 48h 自动生成一次';
COMMENT ON COLUMN system_reports.report_type IS '简报类型，默认 system_48h';
COMMENT ON COLUMN system_reports.content IS 'LLM 生成的简报内容（Markdown）';
COMMENT ON COLUMN system_reports.generated_at IS '简报生成时间';
COMMENT ON COLUMN system_reports.metadata IS '附加元数据（任务统计、版本信息等）';

INSERT INTO schema_version (version, description)
VALUES ('115', 'Add system_reports table for 48h automated briefings')
ON CONFLICT (version) DO NOTHING;
