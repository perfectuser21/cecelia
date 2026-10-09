-- 439: ops_runs — 流程执行记录（运行舱刀6，task bfad945f）
-- 数据源：n8n execution_entity（hk-vps 容器 zenithjoy-db-postgres 库 n8n）。
-- 主理人要求：每次 run 要能看到在哪台机器、跑多久、成功失败。
-- token 消耗 n8n 不记录（在 OpenClaw 会话侧），另开一刀。
CREATE TABLE IF NOT EXISTS ops_runs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'n8n',
  run_id TEXT NOT NULL,              -- n8n execution id
  wf_id TEXT NOT NULL,               -- 对应 ops_workflows.wf_id
  status TEXT NOT NULL,              -- success | error | crashed | running
  mode TEXT,                         -- webhook | integrated | manual …
  machine TEXT,                      -- 在哪台机器跑
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  duration_sec INTEGER,              -- crashed 无 stoppedAt 时为 NULL（禁编造）
  notion_id TEXT,
  notion_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, run_id)
);
CREATE INDEX IF NOT EXISTS idx_ops_runs_wf ON ops_runs (wf_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_runs_started ON ops_runs (started_at DESC);

-- 流程侧加：机器 + 健康汇总（避免每次现算 4000+ 行）
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS machine TEXT;
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS run_total INTEGER;
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS run_success_rate INTEGER;
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS run_avg_sec INTEGER;
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS last_run_status TEXT;
