-- Migration 132: 创建 scan_results 表
-- 记录每次扫描发现的问题条目，用于去重和历史趋势追踪
-- 与 code_scans（131）的关系：code_scans 是扫描会话，scan_results 是发现的问题条目

CREATE TABLE IF NOT EXISTS scan_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scanner_name TEXT NOT NULL,
  module_path TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  current_value NUMERIC,
  target_value NUMERIC,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 去重查询索引：(scanner_name, module_path, issue_type)
CREATE INDEX IF NOT EXISTS idx_scan_results_dedup
  ON scan_results (scanner_name, module_path, issue_type);

-- 时间排序索引（趋势查询）
CREATE INDEX IF NOT EXISTS idx_scan_results_scanned_at
  ON scan_results (scanned_at DESC);

COMMENT ON TABLE scan_results IS '扫描问题条目表，记录每次扫描发现的具体问题，用于去重和历史趋势追踪';
COMMENT ON COLUMN scan_results.scanner_name IS '扫描器名称：coverage / complexity / untested';
COMMENT ON COLUMN scan_results.module_path IS '问题所在的模块文件路径';
COMMENT ON COLUMN scan_results.issue_type IS '问题类型：low_coverage / high_complexity / no_test';
COMMENT ON COLUMN scan_results.current_value IS '当前指标值（如覆盖率百分比）';
COMMENT ON COLUMN scan_results.target_value IS '目标指标值';
COMMENT ON COLUMN scan_results.task_id IS '关联的任务 ID（去重跳过时为 NULL）';
COMMENT ON COLUMN scan_results.scanned_at IS '扫描时间';
