-- Migration 317: create evals table for skill-eval service
CREATE TABLE IF NOT EXISTS evals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL,
  skill_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed(dispatch)', 'failed(crash)', 'failed(timeout)', 'failed(publish)')),
  report_url TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evals_task_id_idx ON evals(task_id);
