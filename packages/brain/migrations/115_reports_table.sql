-- Migration 115: 简报表
-- 存储 48h 自动生成的系统简报

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type VARCHAR(50) NOT NULL DEFAULT 'system_48h',
  interval_hours INTEGER NOT NULL DEFAULT 48,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  summary TEXT,
  tasks_completed INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,
  tasks_total INTEGER DEFAULT 0,
  health_status VARCHAR(20) DEFAULT 'unknown',
  generated_by VARCHAR(50) DEFAULT 'cortex',
  pushed_to_ws BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(report_type);

COMMENT ON TABLE reports IS '定期系统简报，由 Brain tick 循环自动生成';
COMMENT ON COLUMN reports.content IS '完整简报 JSON，包含任务统计、系统健康、事件列表等';
COMMENT ON COLUMN reports.health_status IS 'healthy | degraded | critical | unknown';
