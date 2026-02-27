-- Migration 087: 创建 suggestions 表用于存储 Agent 返回的建议
-- 实现队列和 triage 逻辑，用于定期评估

-- 创建 suggestions 表
CREATE TABLE IF NOT EXISTS suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    content TEXT NOT NULL,
    priority_score NUMERIC(3,2) DEFAULT 0.5,
    source VARCHAR(100) NOT NULL,  -- agent_id 或来源标识
    agent_id VARCHAR(100),         -- 具体的 agent ID
    status VARCHAR(50) DEFAULT 'pending',  -- pending, processed, rejected, archived
    suggestion_type VARCHAR(50) DEFAULT 'general',  -- general, task_creation, optimization, alert
    target_entity_type VARCHAR(50),  -- task, goal, project, system
    target_entity_id uuid,           -- 关联的实体 ID
    metadata JSONB DEFAULT '{}',     -- 额外的结构化数据
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    processed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '7 days')
);

-- 创建索引用于查询优化
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_priority_score ON suggestions(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_created_at ON suggestions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_source ON suggestions(source);
CREATE INDEX IF NOT EXISTS idx_suggestions_type ON suggestions(suggestion_type);
CREATE INDEX IF NOT EXISTS idx_suggestions_target ON suggestions(target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_expires_at ON suggestions(expires_at);

-- 创建更新时间触发器
CREATE OR REPLACE FUNCTION update_suggestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_suggestions_updated_at
    BEFORE UPDATE ON suggestions
    FOR EACH ROW
    EXECUTE FUNCTION update_suggestions_updated_at();

-- 创建复合索引用于 triage 查询
CREATE INDEX IF NOT EXISTS idx_suggestions_triage ON suggestions(status, priority_score DESC, created_at);

COMMENT ON TABLE suggestions IS 'Agent 返回的建议存储表，支持优先级评分和队列处理';
COMMENT ON COLUMN suggestions.priority_score IS '优先级评分 0-1，用于 triage 排序';
COMMENT ON COLUMN suggestions.source IS 'Agent 来源标识，如 cortex、thalamus、executor';
COMMENT ON COLUMN suggestions.status IS '状态：pending(待处理)、processed(已处理)、rejected(已拒绝)、archived(已归档)';
COMMENT ON COLUMN suggestions.expires_at IS '过期时间，过期的建议自动标记为 archived';