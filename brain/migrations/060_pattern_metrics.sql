-- Migration 060: 模式识别数据收集 Schema
-- Version: 060
-- Date: 2026-02-23
-- Description: 创建 pattern_metrics 表用于模式识别数据收集

-- 模式识别指标表
CREATE TABLE IF NOT EXISTS pattern_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,

    -- 关联 run_events（通过 run_id 追溯，不做外键约束）
    run_id uuid,
    task_id uuid,

    -- 时间序列维度
    ts_start timestamp with time zone NOT NULL,      -- 周期开始时间
    ts_end timestamp with time zone NOT NULL,        -- 周期结束时间
    period_type text NOT NULL DEFAULT 'hourly',       -- 聚合周期: hourly, daily, weekly

    -- 关键指标（模式识别的核心数据）
    total_runs integer NOT NULL DEFAULT 0,            -- 总运行次数
    success_count integer NOT NULL DEFAULT 0,         -- 成功次数
    failure_count integer NOT NULL DEFAULT 0,        -- 失败次数
    retry_count integer NOT NULL DEFAULT 0,           -- 重试次数

    success_rate numeric(5,4) GENERATED ALWAYS AS (
        CASE WHEN total_runs > 0 THEN success_count::numeric / total_runs ELSE 0 END
    ) STORED,                                          -- 成功率 (0-1)

    avg_response_time_ms numeric(12,2),                -- 平均响应时间（毫秒）
    p95_response_time_ms numeric(12,2),              -- P95 响应时间
    max_response_time_ms numeric(12,2),              -- 最大响应时间
    min_response_time_ms numeric(12,2),              -- 最小响应时间

    -- 错误类型分布（JSONB 存储，便于分析）
    error_types jsonb DEFAULT '{}'::jsonb,             -- {"TIMEOUT": 5, "SELECTOR_NOT_FOUND": 3}
    error_kind_distribution jsonb DEFAULT '{}'::jsonb, -- {"TRANSIENT": 5, "PERSISTENT": 2}

    -- 维度字段（用于分组分析）
    agent text,                                         -- agent 类型: caramel, nobel, qa, audit
    skill text,                                        -- skill 类型: dev, review, talk, etc.
    layer text,                                        -- 执行层级: L0, L1, L2, L3
    task_type text,                                    -- 任务类型: dev, review, talk, data
    executor_host text,                                -- 执行主机: us-vps, hk-vps
    region text,                                       -- 区域: us, hk

    -- 质量指标
    avg_effectiveness_score numeric(3,2),             -- 平均效果评分 (0-1)
    quality_flags jsonb DEFAULT '{}'::jsonb,          -- 质量标记: {"slow_response": true, "high_retry": false}

    -- 元数据
    metadata jsonb DEFAULT '{}'::jsonb,                -- 灵活扩展字段
    created_at timestamp with time zone DEFAULT now()
);

-- 索引：时间序列查询
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_time
    ON pattern_metrics(ts_start, ts_end);
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_period
    ON pattern_metrics(period_type, ts_start);

-- 索引：维度查询
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_agent
    ON pattern_metrics(agent) WHERE agent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_skill
    ON pattern_metrics(skill) WHERE skill IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_layer
    ON pattern_metrics(layer) WHERE layer IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_task_type
    ON pattern_metrics(task_type) WHERE task_type IS NOT NULL;

-- 索引：关联查询
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_run_id
    ON pattern_metrics(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_task_id
    ON pattern_metrics(task_id) WHERE task_id IS NOT NULL;

-- 索引：常用组合查询
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_agent_period
    ON pattern_metrics(agent, period_type, ts_start);
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_skill_period
    ON pattern_metrics(skill, period_type, ts_start);
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_layer_period
    ON pattern_metrics(layer, period_type, ts_start);

-- 表注释
COMMENT ON TABLE pattern_metrics IS '模式识别数据收集表 - 用于聚合和分析执行指标，支持时间序列查询和模式识别';
COMMENT ON COLUMN pattern_metrics.period_type IS '聚合周期: hourly(小时), daily(天), weekly(周)';
COMMENT ON COLUMN pattern_metrics.success_rate IS '成功率 = success_count / total_runs (0-1范围)';
COMMENT ON COLUMN pattern_metrics.error_types IS '错误类型分布 JSON: {"TIMEOUT": 5, "SELECTOR_NOT_FOUND": 3}';
COMMENT ON COLUMN pattern_metrics.error_kind_distribution IS '错误种类分布 JSON: {"TRANSIENT": 5, "PERSISTENT": 2, "RESOURCE": 1}';

-- schema version
INSERT INTO schema_version (version, description)
VALUES ('060', 'Pattern metrics data collection schema')
ON CONFLICT (version) DO NOTHING;
