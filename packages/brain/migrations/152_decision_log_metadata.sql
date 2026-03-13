-- migration 152: 给 decision_log 添加 metadata JSONB 列
-- 存储 Cortex LLM 调用的计时指标：prompt_tokens_est, response_ms, timed_out, error_type
ALTER TABLE decision_log ADD COLUMN IF NOT EXISTS metadata JSONB;
