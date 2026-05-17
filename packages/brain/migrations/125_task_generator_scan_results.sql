-- 125_task_generator_scan_results.sql
-- 代码质量扫描结果表
-- 用于存储扫描器发现的问题和生成的任务

CREATE TABLE IF NOT EXISTS scan_results (
    id SERIAL PRIMARY KEY,
    scanner_name VARCHAR(100) NOT NULL,
    module_path VARCHAR(500),
    issue_type VARCHAR(100),
    current_value FLOAT,
    target_value FLOAT,
    task_id UUID REFERENCES tasks(id),
    scanned_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_scan_results_scanner_name ON scan_results(scanner_name);
CREATE INDEX IF NOT EXISTS idx_scan_results_module_path ON scan_results(module_path);
CREATE INDEX IF NOT EXISTS idx_scan_results_task_id ON scan_results(task_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_scanned_at ON scan_results(scanned_at);

-- 注释
COMMENT ON TABLE scan_results IS '代码质量扫描结果表，存储覆盖率、复杂度、未测试模块等扫描结果';
COMMENT ON COLUMN scan_results.scanner_name IS '扫描器名称：coverage, complexity, untested';
COMMENT ON COLUMN scan_results.module_path IS '问题模块路径';
COMMENT ON COLUMN scan_results.issue_type IS '问题类型：low_coverage, high_complexity, no_test';
COMMENT ON COLUMN scan_results.current_value IS '当前值（如覆盖率百分比、圈复杂度）';
COMMENT ON COLUMN scan_results.target_value IS '目标值';
COMMENT ON COLUMN scan_results.task_id IS '关联的任务 ID';
COMMENT ON COLUMN scan_results.scanned_at IS '扫描时间';
