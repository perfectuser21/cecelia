-- Migration 008: Alertness Signal Path Tables
-- KR4: 大脑知道自己病了

-- Drop existing tables if needed (for clean migration)
DROP TABLE IF EXISTS self_healing_log CASCADE;
DROP TABLE IF EXISTS alertness_escalations CASCADE;
DROP TABLE IF EXISTS alertness_metrics CASCADE;

-- ============================================================
-- 1. Alertness Metrics Table
-- ============================================================

CREATE TABLE IF NOT EXISTS alertness_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metric_type VARCHAR(50) NOT NULL,
  metric_value NUMERIC NOT NULL,
  threshold_status VARCHAR(20) CHECK (threshold_status IN ('normal', 'warning', 'danger')),
  alertness_level INTEGER CHECK (alertness_level >= 0 AND alertness_level <= 4),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_alertness_metrics_timestamp ON alertness_metrics(timestamp DESC);
CREATE INDEX idx_alertness_metrics_type_timestamp ON alertness_metrics(metric_type, timestamp DESC);
CREATE INDEX idx_alertness_metrics_level ON alertness_metrics(alertness_level);

-- Comments
COMMENT ON TABLE alertness_metrics IS 'Real-time system metrics for alertness monitoring';
COMMENT ON COLUMN alertness_metrics.metric_type IS 'Type of metric: memory, cpu, responseTime, errorRate, queueDepth';
COMMENT ON COLUMN alertness_metrics.threshold_status IS 'Status relative to thresholds: normal, warning, danger';
COMMENT ON COLUMN alertness_metrics.alertness_level IS 'Current alertness level (0=SLEEPING, 1=CALM, 2=AWARE, 3=ALERT, 4=PANIC)';

-- ============================================================
-- 2. Alertness Escalations Table
-- ============================================================

CREATE TABLE IF NOT EXISTS alertness_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  from_level INTEGER,
  to_level INTEGER NOT NULL,
  trigger_reason TEXT,
  response_level VARCHAR(20) CHECK (response_level IN ('auto_recovery', 'graceful_degrade', 'emergency_brake', 'human_intervention')),
  actions_taken JSONB,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_alertness_escalations_timestamp ON alertness_escalations(timestamp DESC);
CREATE INDEX idx_alertness_escalations_unresolved ON alertness_escalations(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_alertness_escalations_level ON alertness_escalations(to_level);

-- Comments
COMMENT ON TABLE alertness_escalations IS 'History of alertness level changes and escalations';
COMMENT ON COLUMN alertness_escalations.from_level IS 'Previous alertness level';
COMMENT ON COLUMN alertness_escalations.to_level IS 'New alertness level';
COMMENT ON COLUMN alertness_escalations.response_level IS 'Response level triggered';
COMMENT ON COLUMN alertness_escalations.actions_taken IS 'JSON array of actions executed';
COMMENT ON COLUMN alertness_escalations.resolved_at IS 'When the escalation was resolved';

-- ============================================================
-- 3. Self Healing Log Table
-- ============================================================

CREATE TABLE IF NOT EXISTS self_healing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issue_type VARCHAR(100),
  strategy_used VARCHAR(100),
  actions_executed JSONB,
  success BOOLEAN,
  recovery_time_seconds INTEGER,
  metrics_before JSONB,
  metrics_after JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_self_healing_log_timestamp ON self_healing_log(timestamp DESC);
CREATE INDEX idx_self_healing_log_success ON self_healing_log(success);
CREATE INDEX idx_self_healing_log_issue_type ON self_healing_log(issue_type);

-- Comments
COMMENT ON TABLE self_healing_log IS 'Log of self-healing attempts and results';
COMMENT ON COLUMN self_healing_log.issue_type IS 'Type of issue detected (e.g., high_memory, queue_overflow)';
COMMENT ON COLUMN self_healing_log.strategy_used IS 'Healing strategy applied';
COMMENT ON COLUMN self_healing_log.actions_executed IS 'JSON array of specific actions taken';
COMMENT ON COLUMN self_healing_log.success IS 'Whether the healing was successful';
COMMENT ON COLUMN self_healing_log.recovery_time_seconds IS 'Time taken to recover';
COMMENT ON COLUMN self_healing_log.metrics_before IS 'System metrics before healing';
COMMENT ON COLUMN self_healing_log.metrics_after IS 'System metrics after healing';

-- ============================================================
-- 4. Add tick_history table if not exists
-- ============================================================

CREATE TABLE IF NOT EXISTS tick_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tick_number BIGINT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  execution_time_ms INTEGER,
  actions_taken JSONB,
  metrics JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tick_history_started ON tick_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tick_history_tick_number ON tick_history(tick_number);

-- Comments
COMMENT ON TABLE tick_history IS 'History of tick executions';
COMMENT ON COLUMN tick_history.execution_time_ms IS 'Time taken to execute the tick in milliseconds';

-- ============================================================
-- 5. Add error_logs table if not exists
-- ============================================================

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity VARCHAR(20) CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
  source VARCHAR(100),
  message TEXT,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity);

-- Comments
COMMENT ON TABLE error_logs IS 'System error logs';

-- ============================================================
-- 6. Add task_runs table if not exists
-- ============================================================

CREATE TABLE IF NOT EXISTS task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
  output TEXT,
  error TEXT,
  pid INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, run_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
CREATE INDEX IF NOT EXISTS idx_task_runs_started ON task_runs(started_at DESC);

-- Comments
COMMENT ON TABLE task_runs IS 'Execution history for tasks';

-- ============================================================
-- 7. Create views for monitoring
-- ============================================================

-- Current alertness status view
CREATE OR REPLACE VIEW v_current_alertness AS
SELECT
  ae.to_level as current_level,
  CASE ae.to_level
    WHEN 0 THEN 'SLEEPING'
    WHEN 1 THEN 'CALM'
    WHEN 2 THEN 'AWARE'
    WHEN 3 THEN 'ALERT'
    WHEN 4 THEN 'PANIC'
  END as level_name,
  ae.timestamp as since,
  EXTRACT(EPOCH FROM (NOW() - ae.timestamp)) / 60 as minutes_in_state,
  ae.trigger_reason,
  ae.response_level
FROM alertness_escalations ae
WHERE ae.timestamp = (SELECT MAX(timestamp) FROM alertness_escalations);

-- Recent metrics summary view
CREATE OR REPLACE VIEW v_recent_metrics AS
SELECT
  metric_type,
  AVG(metric_value) as avg_value,
  MAX(metric_value) as max_value,
  MIN(metric_value) as min_value,
  COUNT(*) as sample_count,
  MAX(CASE WHEN threshold_status = 'danger' THEN 1 ELSE 0 END) as has_danger,
  MAX(CASE WHEN threshold_status = 'warning' THEN 1 ELSE 0 END) as has_warning
FROM alertness_metrics
WHERE timestamp > NOW() - INTERVAL '15 minutes'
GROUP BY metric_type;

-- Healing success rate view
CREATE OR REPLACE VIEW v_healing_stats AS
SELECT
  COUNT(*) as total_attempts,
  COUNT(*) FILTER (WHERE success = true) as successful,
  COUNT(*) FILTER (WHERE success = false) as failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE success = true) / NULLIF(COUNT(*), 0), 2) as success_rate,
  AVG(recovery_time_seconds) FILTER (WHERE success = true) as avg_recovery_seconds
FROM self_healing_log
WHERE timestamp > NOW() - INTERVAL '7 days';

-- ============================================================
-- 8. Grant permissions
-- ============================================================

GRANT ALL ON alertness_metrics TO cecelia_user;
GRANT ALL ON alertness_escalations TO cecelia_user;
GRANT ALL ON self_healing_log TO cecelia_user;
GRANT ALL ON tick_history TO cecelia_user;
GRANT ALL ON error_logs TO cecelia_user;
GRANT ALL ON task_runs TO cecelia_user;
GRANT SELECT ON v_current_alertness TO cecelia_user;
GRANT SELECT ON v_recent_metrics TO cecelia_user;
GRANT SELECT ON v_healing_stats TO cecelia_user;

-- ============================================================
-- Migration complete
-- ============================================================