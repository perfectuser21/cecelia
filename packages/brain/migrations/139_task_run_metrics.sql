-- Migration 139: 任务执行全链路 metrics 采集
-- 新建 task_run_metrics 专用表，聚合 LLM 指标 + 资源指标 + PR 结果
-- 数据来源：
--   LLM metrics  ← execution-callback 解析 claude CLI result JSON
--   RSS/CPU      ← watchdog cleanupMetrics() 写入
--   PR 结果      ← pr-callback-handler 合并时更新

CREATE TABLE IF NOT EXISTS task_run_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id          TEXT,                              -- cecelia-run checkpoint ID
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (task_id, run_id),

  -- 时间维度
  queued_duration_ms    INTEGER,                     -- 排队等待时长（started_at - queued_at）
  execution_duration_ms INTEGER,                     -- 实际执行时长（duration_ms from callback）

  -- LLM 模型维度
  model_id              TEXT,                        -- 主模型（cost 最高的那个）
  num_turns             INTEGER,                     -- LLM 对话轮数
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  cache_read_tokens     INTEGER,
  cache_creation_tokens INTEGER,
  cache_hit_rate        NUMERIC(5,4),                -- cache_read / (input + cache_read)，0~1
  cost_usd              NUMERIC(10,6),               -- total_cost_usd
  context_window_pct    NUMERIC(5,2),                -- 已用 context 窗口百分比（预留）

  -- 资源维度（watchdog 采样）
  peak_rss_mb           INTEGER,
  avg_rss_mb            INTEGER,
  peak_cpu_pct          NUMERIC(5,2),
  avg_cpu_pct           NUMERIC(5,2),
  child_process_count   INTEGER,                     -- 峰值子进程数（vitest forks 等）

  -- 结果维度
  exit_status           TEXT,                        -- success / failed / timeout / oom_killed
  failure_category      TEXT,                        -- ci_failure / api_error / oom / timeout / unknown
  retry_count           INTEGER DEFAULT 0,

  -- PR 结果（pr-callback-handler 回填）
  pr_ci_passed          BOOLEAN,
  pr_merged             BOOLEAN DEFAULT FALSE
);

-- 索引：按 task_id 快速查单任务指标
CREATE INDEX IF NOT EXISTS idx_task_run_metrics_task_id ON task_run_metrics(task_id);

-- 索引：按时间范围聚合
CREATE INDEX IF NOT EXISTS idx_task_run_metrics_created_at ON task_run_metrics(created_at);

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_task_run_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_task_run_metrics_updated_at
  BEFORE UPDATE ON task_run_metrics
  FOR EACH ROW EXECUTE FUNCTION update_task_run_metrics_updated_at();

-- 视图：task_run_profiles — 完整链路一张表
-- 从 task_run_metrics JOIN tasks JOIN projects(initiative) JOIN projects(project) JOIN goals(KR)
CREATE OR REPLACE VIEW task_run_profiles AS
SELECT
  -- 指标层
  m.id               AS metric_id,
  m.task_id,
  m.run_id,
  m.created_at       AS run_at,
  m.queued_duration_ms,
  m.execution_duration_ms,
  m.model_id,
  m.num_turns,
  m.input_tokens,
  m.output_tokens,
  m.cache_read_tokens,
  m.cache_creation_tokens,
  m.cache_hit_rate,
  m.cost_usd,
  m.peak_rss_mb,
  m.avg_rss_mb,
  m.peak_cpu_pct,
  m.avg_cpu_pct,
  m.child_process_count,
  m.exit_status,
  m.failure_category,
  m.retry_count,
  m.pr_ci_passed,
  m.pr_merged,

  -- 任务层
  t.title            AS task_title,
  t.task_type,
  t.priority,
  t.status           AS task_status,
  t.queued_at,
  t.started_at,
  t.completed_at,
  t.pr_url,

  -- Initiative 层（tasks.project_id → projects where type='initiative'）
  ini.id             AS initiative_id,
  ini.name           AS initiative_title,
  ini.domain         AS initiative_domain,

  -- Project 层（initiative.parent_id → projects where type='project'）
  proj.id            AS project_id,
  proj.name          AS project_title,

  -- KR 层（project.kr_id → goals）
  kr.id              AS kr_id,
  kr.title           AS kr_title,
  kr.status          AS kr_status

FROM task_run_metrics m
JOIN tasks t ON t.id = m.task_id
LEFT JOIN projects ini  ON ini.id = t.project_id
LEFT JOIN projects proj ON proj.id = ini.parent_id
LEFT JOIN goals kr      ON kr.id = proj.kr_id;

-- schema_version 记录
INSERT INTO schema_version (version, description)
VALUES ('139', 'task_run_metrics table + task_run_profiles view')
ON CONFLICT (version) DO NOTHING;
