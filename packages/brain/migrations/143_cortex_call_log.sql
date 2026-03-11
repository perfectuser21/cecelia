-- Migration 143: cortex_call_log — Cortex LLM 调用历史记录
-- Purpose: 记录每次 Cortex 皮层 LLM 调用的状态、耗时、模型、错误摘要，便于排查失败

CREATE TABLE IF NOT EXISTS cortex_call_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts          TIMESTAMP DEFAULT NOW(),
  trigger     VARCHAR(100),           -- 调用来源（event type 或 'generate_system_report'）
  status      VARCHAR(20),            -- 'success' | 'failed' (timeout 由 API 层派生)
  duration_ms INTEGER,                -- 调用耗时（ms），来自 llm-caller.elapsed_ms
  http_status INTEGER,                -- HTTP 状态码（如有），失败时从 err.status 取
  model       VARCHAR(100),           -- 实际使用的模型 ID
  error_summary TEXT                  -- 失败时的错误摘要（截取前 500 字符）
);

CREATE INDEX IF NOT EXISTS idx_cortex_call_log_ts ON cortex_call_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_cortex_call_log_status ON cortex_call_log(status);

INSERT INTO schema_version (version, description)
VALUES ('143', 'Add cortex_call_log for Cortex LLM call history observability');
