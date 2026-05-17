-- Migration 220: 为 tasks 表添加 result jsonb 列，用于存储执行元数据
-- Sprint 3: 执行成本追踪（token/cost 写入 DB）

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result jsonb;

COMMENT ON COLUMN tasks.result IS 'execution metadata: duration_ms, total_cost_usd, num_turns, input_tokens, output_tokens';
