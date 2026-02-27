-- Migration 087: Progress Ledger inner loop
-- 任务执行进展追踪表，记录每个步骤的执行状态和评估结果
-- 在 tick 循环中进行进展评估，检测偏差并调整策略

-- progress_ledger: 记录任务执行过程中的步骤进展
CREATE TABLE IF NOT EXISTS progress_ledger (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_id UUID NOT NULL, -- 关联到 execution-callback 的 run_id

    -- 步骤标识
    step_sequence INTEGER NOT NULL, -- 步骤序号（1, 2, 3...）
    step_name VARCHAR(255) NOT NULL, -- 步骤名称
    step_type VARCHAR(100) NOT NULL DEFAULT 'execution', -- execution/validation/cleanup 等

    -- 执行状态
    status VARCHAR(50) NOT NULL DEFAULT 'queued', -- queued/in_progress/completed/failed/skipped
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER, -- 执行耗时（毫秒）

    -- 步骤详情
    input_summary TEXT, -- 步骤输入摘要
    output_summary TEXT, -- 步骤输出摘要
    findings JSONB DEFAULT '{}', -- 步骤发现和结果

    -- 错误处理
    error_code VARCHAR(100), -- 错误代码
    error_message TEXT, -- 错误消息
    retry_count INTEGER DEFAULT 0, -- 重试次数

    -- 扩展数据
    artifacts JSONB DEFAULT '{}', -- 生成的工件信息
    metadata JSONB DEFAULT '{}', -- 元数据（配置、参数等）
    confidence_score DECIMAL(3,2) DEFAULT 1.0, -- 对步骤成功的信心（0.0-1.0）

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- progress_ledger_review: Tick 循环中的进展评估记录
CREATE TABLE IF NOT EXISTS progress_ledger_review (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_id UUID NOT NULL,
    ledger_entry_id BIGINT REFERENCES progress_ledger(id) ON DELETE CASCADE,

    -- 评估上下文
    tick_id UUID NOT NULL, -- 本次 tick 的标识
    tick_number INTEGER NOT NULL, -- tick 序号

    -- 评估结果
    review_action VARCHAR(50) NOT NULL, -- continue/retry/escalate/pause/abandon
    review_reason TEXT, -- 评估理由
    risk_assessment VARCHAR(20) DEFAULT 'low', -- low/medium/high

    -- AI 决策
    ai_model VARCHAR(100), -- decision_engine/thalamus/cortex
    ai_decision JSONB DEFAULT '{}', -- AI 决策详情和理由

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_progress_ledger_task_run ON progress_ledger(task_id, run_id);
CREATE INDEX IF NOT EXISTS idx_progress_ledger_status ON progress_ledger(status);
CREATE INDEX IF NOT EXISTS idx_progress_ledger_sequence ON progress_ledger(task_id, step_sequence);
CREATE INDEX IF NOT EXISTS idx_progress_ledger_created_at ON progress_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_progress_ledger_started_at ON progress_ledger(started_at);
CREATE INDEX IF NOT EXISTS idx_progress_ledger_completed_at ON progress_ledger(completed_at);

CREATE INDEX IF NOT EXISTS idx_progress_ledger_review_task ON progress_ledger_review(task_id);
CREATE INDEX IF NOT EXISTS idx_progress_ledger_review_tick ON progress_ledger_review(tick_id);

-- 视图：任务进展摘要
CREATE OR REPLACE VIEW v_task_progress_summary AS
SELECT
    task_id,
    run_id,
    COUNT(*) as total_steps,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_steps,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_steps,
    COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_steps,
    ROUND(
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::DECIMAL / COUNT(*)::DECIMAL * 100, 2
    ) as completion_percentage,
    SUM(duration_ms) as total_duration_ms,
    AVG(confidence_score) as avg_confidence,
    MIN(started_at) as first_step_started,
    MAX(completed_at) as last_step_completed
FROM progress_ledger
GROUP BY task_id, run_id;

-- 视图：最新进展步骤（用于仪表板）
CREATE OR REPLACE VIEW v_latest_progress_step AS
WITH latest_steps AS (
    SELECT DISTINCT ON (task_id, run_id)
        task_id, run_id, step_sequence, step_name, status,
        started_at, completed_at, confidence_score,
        ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY step_sequence DESC) as rn
    FROM progress_ledger
    ORDER BY task_id, run_id, step_sequence DESC
)
SELECT * FROM latest_steps WHERE rn = 1;

-- 自动更新时间戳触发器
CREATE OR REPLACE FUNCTION update_progress_ledger_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS tr_progress_ledger_updated_at ON progress_ledger;
CREATE TRIGGER tr_progress_ledger_updated_at
    BEFORE UPDATE ON progress_ledger
    FOR EACH ROW EXECUTE FUNCTION update_progress_ledger_timestamp();

-- 数据完整性约束
ALTER TABLE progress_ledger
    ADD CONSTRAINT chk_progress_ledger_status
    CHECK (status IN ('queued', 'in_progress', 'completed', 'failed', 'skipped'));

ALTER TABLE progress_ledger
    ADD CONSTRAINT chk_progress_ledger_confidence
    CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0);

ALTER TABLE progress_ledger_review
    ADD CONSTRAINT chk_progress_review_action
    CHECK (review_action IN ('continue', 'retry', 'escalate', 'pause', 'abandon'));

ALTER TABLE progress_ledger_review
    ADD CONSTRAINT chk_progress_review_risk
    CHECK (risk_assessment IN ('low', 'medium', 'high'));