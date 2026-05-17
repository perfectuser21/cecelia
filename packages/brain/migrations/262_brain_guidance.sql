-- Migration 262: brain_guidance — Brain 双层架构握手表
-- 背景：tick-runner.js 主链路有 5 处串行 await LLM 调用，超出 TICK_TIMEOUT_MS。
-- 设计：调度层（tick-scheduler）只读 brain_guidance 做决策（~1ms），
-- 意识层（consciousness-loop）异步跑 LLM 把建议写进表，两层完全解耦。
-- Spec: docs/superpowers/specs/2026-05-04-brain-scheduler-consciousness-split.md

CREATE TABLE IF NOT EXISTS brain_guidance (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  source      TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_guidance_expires
  ON brain_guidance (expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE  brain_guidance            IS '意识层向调度层传递指导的异步握手表（Layer 2 写，Layer 1 读）';
COMMENT ON COLUMN brain_guidance.key        IS 'Key 命名规范: routing:{task_id} | strategy:global | cooldown:{provider} | reflection:latest';
COMMENT ON COLUMN brain_guidance.source     IS '写入方: thalamus | cortex | reflection | memory';
COMMENT ON COLUMN brain_guidance.expires_at IS 'NULL = 永不过期；过期条目由 clearExpired() 清理';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('262', 'brain_guidance: two-layer architecture handshake table (scheduler reads, consciousness writes)', NOW())
ON CONFLICT DO NOTHING;
