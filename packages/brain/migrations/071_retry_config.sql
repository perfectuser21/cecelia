-- Migration 071: Retry Config CRUD API
--
-- 功能：创建 retry_config 表，支持重试策略的动态管理
-- 用于：允许通过 API 动态配置不同任务类型的重试策略
--
-- 1. 创建 retry_config 表
-- 2. 插入默认重试策略配置
-- 3. 更新 schema version

-- ============================================================
-- 1. Create retry_config table
-- ============================================================
CREATE TABLE IF NOT EXISTS retry_config (
    config_id SERIAL PRIMARY KEY,
    task_type VARCHAR(50) NOT NULL,
    max_retries INTEGER NOT NULL DEFAULT 3,
    initial_delay_seconds INTEGER NOT NULL DEFAULT 60,
    max_delay_seconds INTEGER NOT NULL DEFAULT 3600,
    backoff_multiplier DECIMAL(3,2) NOT NULL DEFAULT 2.0,
    retryable_errors TEXT[] DEFAULT ARRAY['network_error', 'timeout', 'rate_limit'],
    enabled BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(100),
    UNIQUE(task_type)
);

-- ============================================================
-- 2. Create indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_retry_config_task_type ON retry_config(task_type);
CREATE INDEX IF NOT EXISTS idx_retry_config_enabled ON retry_config(enabled);

-- ============================================================
-- 3. Insert default retry strategies
-- ============================================================

-- Dev 任务：较长重试时间
INSERT INTO retry_config (task_type, max_retries, initial_delay_seconds, max_delay_seconds, backoff_multiplier, retryable_errors, enabled, description, created_by)
VALUES ('dev', 5, 120, 7200, 2.5, ARRAY['network_error', 'timeout', 'rate_limit', 'server_error'], true, '开发任务重试策略', 'system')
ON CONFLICT (task_type) DO NOTHING;

-- Research 任务：中等重试
INSERT INTO retry_config (task_type, max_retries, initial_delay_seconds, max_delay_seconds, backoff_multiplier, retryable_errors, enabled, description, created_by)
VALUES ('research', 3, 60, 1800, 2.0, ARRAY['network_error', 'timeout'], true, '研究任务重试策略', 'system')
ON CONFLICT (task_type) DO NOTHING;

-- Review 任务：较短重试
INSERT INTO retry_config (task_type, max_retries, initial_delay_seconds, max_delay_seconds, backoff_multiplier, retryable_errors, enabled, description, created_by)
VALUES ('review', 2, 30, 300, 2.0, ARRAY['network_error', 'timeout'], true, '审查任务重试策略', 'system')
ON CONFLICT (task_type) DO NOTHING;

-- Default 配置（用于未匹配的任务类型）
INSERT INTO retry_config (task_type, max_retries, initial_delay_seconds, max_delay_seconds, backoff_multiplier, retryable_errors, enabled, description, created_by)
VALUES ('default', 3, 60, 1800, 2.0, ARRAY['network_error', 'timeout', 'rate_limit'], true, '默认重试策略', 'system')
ON CONFLICT (task_type) DO NOTHING;

-- ============================================================
-- 4. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('071', 'Retry Config CRUD API')
ON CONFLICT (version) DO NOTHING;
