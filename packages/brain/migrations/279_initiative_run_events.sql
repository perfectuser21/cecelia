-- Migration 279: initiative_run_events — harness pipeline 节点状态流表
-- DoD ws3 规范：ts BIGINT（Unix 秒）、status IN ('running','done','failed')、无 label 列
-- 供 GET /api/brain/harness/stream?initiative_id=... SSE 端点消费

CREATE TABLE IF NOT EXISTS initiative_run_events (
  id            BIGSERIAL   PRIMARY KEY,
  initiative_id UUID        NOT NULL,
  node          TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  attempt       INT         NOT NULL DEFAULT 1,
  ts            BIGINT      NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_initiative_run_events_initiative
  ON initiative_run_events (initiative_id, ts);
