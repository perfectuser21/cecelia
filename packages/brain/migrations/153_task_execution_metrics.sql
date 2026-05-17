-- Migration 153: task_execution_metrics — per-task consumption records
-- Written at execution-callback time to track account/duration/estimated requests

CREATE TABLE IF NOT EXISTS task_execution_metrics (
  id              SERIAL PRIMARY KEY,
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  account_id      VARCHAR(100),          -- dispatched Claude account (null if MiniMax)
  duration_ms     INTEGER,               -- wall-clock execution time
  est_requests    NUMERIC(10,2),         -- estimated API requests (duration_ms / 30000)
  status          VARCHAR(50),           -- final task status (completed/failed/etc.)
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_exec_metrics_task_id ON task_execution_metrics(task_id);
CREATE INDEX IF NOT EXISTS idx_task_exec_metrics_account ON task_execution_metrics(account_id);
CREATE INDEX IF NOT EXISTS idx_task_exec_metrics_recorded ON task_execution_metrics(recorded_at DESC);
