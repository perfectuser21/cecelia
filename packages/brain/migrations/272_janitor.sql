-- 271_janitor.sql: Janitor 维护任务 DB 支持
CREATE TABLE IF NOT EXISTS janitor_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      TEXT NOT NULL,
  job_name    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('running','success','failed','skipped')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  output      TEXT,
  freed_bytes BIGINT
);

CREATE INDEX IF NOT EXISTS janitor_runs_job_id_started_at
  ON janitor_runs (job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS janitor_config (
  job_id     TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  schedule   TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO janitor_config (job_id, enabled, schedule)
VALUES ('docker-prune', true, '0 2 * * *')
ON CONFLICT (job_id) DO NOTHING;
