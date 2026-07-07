CREATE TABLE skill_eval_tasks (
  task_id        TEXT PRIMARY KEY,
  zip_hash       TEXT NOT NULL,
  zip_path       TEXT,
  skill_name     TEXT NOT NULL,
  platform       TEXT DEFAULT 'unknown',
  report_url     TEXT,
  submitter      TEXT,
  pending_reason TEXT,
  failure_reason TEXT,
  container_id   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','running','in_progress','completed','failed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_skill_eval_status ON skill_eval_tasks(status);
CREATE INDEX idx_skill_eval_hash ON skill_eval_tasks(zip_hash);
INSERT INTO schema_version (version) VALUES ('318');
