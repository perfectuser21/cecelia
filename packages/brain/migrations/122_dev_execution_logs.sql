-- dev_execution_logs: 记录 /dev skill 每次执行的关键信息
-- 用于监控执行状态、统计成功率、分析失败原因

CREATE TABLE IF NOT EXISTS dev_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id),
  run_id UUID NOT NULL,
  phase VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  error_message TEXT,
  metadata JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_logs_task ON dev_execution_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_dev_logs_run ON dev_execution_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_dev_logs_phase_status ON dev_execution_logs(phase, status);
