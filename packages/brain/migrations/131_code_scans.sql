-- Migration 131: 创建 code_scans 表
-- 记录每次代码质量扫描会话（由 /api/brain/code-scanner/analyze 触发）
-- 与 scan_results 的关系：code_scans 是扫描会话，scan_results 是扫描发现的问题条目

CREATE TABLE IF NOT EXISTS code_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_path TEXT NOT NULL,
  scan_type TEXT NOT NULL DEFAULT 'coverage',
  scan_results JSONB NOT NULL DEFAULT '{}',
  tasks_generated INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按创建时间排序（查询最新扫描）
CREATE INDEX IF NOT EXISTS idx_code_scans_created_at ON code_scans (created_at DESC);

-- 索引：按 repo_path 过滤
CREATE INDEX IF NOT EXISTS idx_code_scans_repo_path ON code_scans (repo_path);

-- 注释
COMMENT ON TABLE code_scans IS '代码质量扫描会话表，记录每次触发的扫描概要';
COMMENT ON COLUMN code_scans.repo_path IS '被扫描的仓库路径';
COMMENT ON COLUMN code_scans.scan_type IS '扫描类型：coverage（覆盖率）、complexity（复杂度）、untested（未测试）、all（全部）';
COMMENT ON COLUMN code_scans.scan_results IS '扫描结果摘要（JSON）：total_files, tested_files, untested_files, coverage_percentage, untested_modules';
COMMENT ON COLUMN code_scans.tasks_generated IS '本次扫描生成的任务数量';
