-- Migration 043: Add dispatch_events table to track task dispatch attempts
-- Applied automatically by Brain at 2026-02-20 23:48:01 (reverse-engineered from DB)

CREATE TABLE IF NOT EXISTS dispatch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('dispatched', 'failed_dispatch', 'skipped')),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_events_task_id ON dispatch_events(task_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_events_type ON dispatch_events(event_type);
CREATE INDEX IF NOT EXISTS idx_dispatch_events_created_at ON dispatch_events(created_at DESC);

INSERT INTO schema_version (version, description) VALUES ('043', 'Add dispatch_events table to track task dispatch attempts')
  ON CONFLICT (version) DO NOTHING;
