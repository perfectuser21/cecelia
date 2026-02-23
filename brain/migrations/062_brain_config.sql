-- Migration 062: Brain Config - 失败重试策略配置化
--
-- 功能：将失败重试策略的硬编码配置抽取到数据库
-- 注意：brain_config 表已存在（migration 000/005），保留原有 key/value 列
-- 策略：只添加新的辅助列，不重命名现有列（避免破坏 selfcheck.js/learning.js 等引用）
--
-- 1. 添加辅助列（config_type, description, min_value, max_value, created_at, updated_by）
-- 2. 插入默认配置值（使用现有 key/value 格式）

-- ============================================================
-- 1. Add auxiliary columns (extend existing schema)
-- ============================================================
ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS config_type VARCHAR(20) NOT NULL DEFAULT 'string';
ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS min_value NUMERIC;
ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS max_value NUMERIC;
ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);

-- ============================================================
-- 2. Insert default retry strategy configs (key/value format)
-- ============================================================

-- Quarantine 配置
INSERT INTO brain_config (key, value, config_type, description, min_value, max_value) VALUES
('quarantine.failure_threshold', '3', 'number', '连续失败多少次后进入隔离区', 1, 10)
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value, config_type, description, min_value, max_value) VALUES
('quarantine.rate_limit_max_retries', '3', 'number', 'Rate limit 错误最大重试次数', 1, 10)
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value, config_type, description, min_value, max_value) VALUES
('quarantine.network_max_retries', '3', 'number', '网络错误最大重试次数', 1, 10)
ON CONFLICT (key) DO NOTHING;

-- Executor 配置
INSERT INTO brain_config (key, value, config_type, description, min_value, max_value) VALUES
('executor.quarantine_after_kills', '2', 'number', '连续被 kill 多少次后进入隔离区', 1, 10)
ON CONFLICT (key) DO NOTHING;

-- Backoff 配置 (JSON 格式存储数组)
INSERT INTO brain_config (key, value, config_type, description, min_value, max_value) VALUES
('executor.rate_limit_backoff_minutes', '[2,4,8]', 'json', 'Rate limit 错误退避时间（分钟）', NULL, NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value, config_type, description, min_value, max_value) VALUES
('executor.network_backoff_seconds', '[30,60,120]', 'json', '网络错误退避时间（秒）', NULL, NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value, config_type, description, min_value, max_value) VALUES
('executor.default_backoff_minutes', '2', 'number', '默认退避时间（分钟）', 1, 60)
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value, config_type, description, min_value, max_value) VALUES
('executor.max_backoff_minutes', '30', 'number', '最大退避时间（分钟）', 1, 120)
ON CONFLICT (key) DO NOTHING;

-- Billing 配置
INSERT INTO brain_config (key, value, config_type, description, min_value, max_value) VALUES
('executor.billing_pause_hours', '2', 'number', 'Billing 错误暂停时长（小时）', 1, 24)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 3. Create index for updates
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_brain_config_updated_at
ON brain_config(updated_at DESC);

-- ============================================================
-- 4. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('062', 'Brain Config - 失败重试策略配置化')
ON CONFLICT (version) DO NOTHING;
