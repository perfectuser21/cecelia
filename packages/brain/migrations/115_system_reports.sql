-- Migration 115: System Reports Table
-- 存储 48h 定时简报的生成结果
-- 触发：tick.js 10.13 步骤，每 REPORT_INTERVAL_HOURS 小时生成一次（默认 48h）

CREATE TABLE IF NOT EXISTS system_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start TIMESTAMPTZ NOT NULL,      -- 报告涵盖的起始时间
  period_end   TIMESTAMPTZ NOT NULL,      -- 报告涵盖的结束时间
  report_type  VARCHAR(50) NOT NULL DEFAULT '48h_summary',
  content      JSONB NOT NULL,            -- 结构化报告内容
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 按创建时间查询最近简报
CREATE INDEX IF NOT EXISTS system_reports_created_at_idx
  ON system_reports (created_at DESC);

-- 按报告类型查询
CREATE INDEX IF NOT EXISTS system_reports_type_idx
  ON system_reports (report_type, created_at DESC);
