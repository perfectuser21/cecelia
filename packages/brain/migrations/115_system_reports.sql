-- Migration 115: system_reports 表
-- 用于存储 Brain 定时生成的系统简报（48h 简报等）

CREATE TABLE IF NOT EXISTS system_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,                          -- 简报类型，如 '48h_summary'
  content JSONB NOT NULL DEFAULT '{}',         -- 简报内容（结构化 JSON）
  metadata JSONB NOT NULL DEFAULT '{}',        -- 元数据（生成耗时、触发方式等）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按类型和时间查询（最常见的查询模式）
CREATE INDEX IF NOT EXISTS idx_system_reports_type_created
  ON system_reports (type, created_at DESC);

-- 索引：按时间查询（列出所有简报）
CREATE INDEX IF NOT EXISTS idx_system_reports_created_at
  ON system_reports (created_at DESC);

COMMENT ON TABLE system_reports IS 'Brain 定时系统简报，包含 48h 任务统计、系统健康状况等';
COMMENT ON COLUMN system_reports.type IS '简报类型：48h_summary | weekly_summary';
COMMENT ON COLUMN system_reports.content IS '简报内容 JSON，包含 tasks_summary, system_health, period_hours 等字段';
COMMENT ON COLUMN system_reports.metadata IS '生成元数据：trigger（auto|manual）, generated_at, duration_ms';

INSERT INTO schema_version (version, description)
VALUES ('115', 'Add system_reports table for 48h periodic reports')
ON CONFLICT (version) DO NOTHING;
