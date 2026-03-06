-- Migration 123: 创建代码质量扫描结果表
-- 用于存储代码扫描发现的问题和改进建议

CREATE TABLE IF NOT EXISTS code_scan_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type VARCHAR(50) NOT NULL,
  file_path TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  suggested_task_title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_scan_results_scan_type ON code_scan_results (scan_type);
CREATE INDEX IF NOT EXISTS idx_code_scan_results_created_at ON code_scan_results (created_at DESC);
