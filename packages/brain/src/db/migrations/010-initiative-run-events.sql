-- Migration 010: initiative_run_events — harness pipeline 事件流表
-- 用途：记录 harness pipeline 各节点（proposer/reviewer/generator/evaluator）的状态变更事件
-- 供 GET /pipeline/:initiative_id/stream SSE 端点消费

CREATE TABLE IF NOT EXISTS initiative_run_events (
  event_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID      NOT NULL,
  node        TEXT        NOT NULL
    CHECK (node IN ('proposer', 'reviewer', 'generator', 'evaluator', 'reporter')),
  status      TEXT        NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ire_initiative_created
  ON initiative_run_events (initiative_id, created_at);
