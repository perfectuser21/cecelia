-- Migration 012: incidents 表
-- task_id: c11cdec4-c845-447f-80da-9d528753be1d
-- 作用：建立 incidents 归一化表，将探针红信号（launchd-patrol / dept-heartbeat / circuit-breaker 等）
--       的告警事件统一写入一条记录，支持幂等去重（fingerprint ON CONFLICT）。

CREATE TABLE IF NOT EXISTS incidents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_id         TEXT        NOT NULL,
  fingerprint      TEXT        NOT NULL UNIQUE,
  severity         TEXT        NOT NULL,
  evidence         JSONB       NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open','triaged','fixing','resolved','postmortem_done')),
  task_id          UUID        REFERENCES tasks(id) ON DELETE SET NULL,
  recurrence_count INTEGER     NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_fingerprint  ON incidents (fingerprint);
CREATE INDEX IF NOT EXISTS idx_incidents_status       ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_probe_id     ON incidents (probe_id);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at   ON incidents (created_at DESC);
