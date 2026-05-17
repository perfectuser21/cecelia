-- Migration 075: watchdog_bottleneck_records table
-- 记录 Watchdog 检测到的资源瓶颈事件（warn/kill）
-- Created: 2026-02-25

-- Update schema version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('075', 'Create watchdog_bottleneck_records table', NOW())
ON CONFLICT (version) DO NOTHING;

-- Create watchdog_bottleneck_records table (idempotent)
CREATE TABLE IF NOT EXISTS watchdog_bottleneck_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id VARCHAR(100),
  pid INTEGER,
  pgid INTEGER,
  slot VARCHAR(50),
  action VARCHAR(20) NOT NULL CHECK (action IN ('warn', 'kill', 'kill_if_top_offender')),
  reason TEXT NOT NULL,
  rss_mb INTEGER,
  cpu_pct INTEGER,
  pressure DECIMAL(5,2),
  evidence JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by task_id
CREATE INDEX IF NOT EXISTS idx_watchdog_bottleneck_task_id
ON watchdog_bottleneck_records(task_id);

-- Index for querying by action type
CREATE INDEX IF NOT EXISTS idx_watchdog_bottleneck_action
ON watchdog_bottleneck_records(action);

-- Index for querying by created_at (time-series queries)
CREATE INDEX IF NOT EXISTS idx_watchdog_bottleneck_created_at
ON watchdog_bottleneck_records(created_at DESC);
