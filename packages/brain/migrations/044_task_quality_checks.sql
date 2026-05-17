-- Migration 044: task_quality_checks table
-- Created automatically by Brain task at 2026-02-21 (reverse-engineered from DB)

CREATE TABLE IF NOT EXISTS task_quality_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  checked_at TIMESTAMP DEFAULT NOW(),
  violations JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(10) CHECK (status IN ('pass', 'fail')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_quality_checks_task_id ON task_quality_checks(task_id);
CREATE INDEX IF NOT EXISTS idx_task_quality_checks_status ON task_quality_checks(status);
CREATE INDEX IF NOT EXISTS idx_task_quality_checks_checked_at ON task_quality_checks(checked_at);

INSERT INTO schema_version (version, description) VALUES ('044', 'task_quality_checks')
  ON CONFLICT (version) DO NOTHING;
