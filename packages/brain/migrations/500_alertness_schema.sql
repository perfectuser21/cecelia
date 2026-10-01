-- 测试/预览只启动被动 API；表由显式迁移准备，不再依赖 initAlertness 的后台评估。
-- 与既有运行时 DDL 相同，已有生产数据保留。

CREATE TABLE IF NOT EXISTS alertness_metrics (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  metric_type VARCHAR(50) NOT NULL,
  metric_value NUMERIC NOT NULL,
  threshold_status VARCHAR(20),
  alertness_level INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alertness_escalations (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  from_level INTEGER NOT NULL,
  to_level INTEGER NOT NULL,
  trigger_reason TEXT,
  response_level VARCHAR(10),
  actions_taken JSONB,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS self_healing_log (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  issue_type VARCHAR(50),
  strategy_used VARCHAR(50),
  actions_executed JSONB,
  success BOOLEAN,
  recovery_time_seconds INTEGER,
  metrics_before JSONB,
  metrics_after JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alertness_metrics_timestamp ON alertness_metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alertness_escalations_timestamp ON alertness_escalations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_self_healing_log_timestamp ON self_healing_log(timestamp DESC);
