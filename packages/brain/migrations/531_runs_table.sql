-- 531: 执行记录统一为 runs + spans + 汇总（决策 ff2019e2，任务 1215b441）
-- 业内通行形状（OpenTelemetry trace/span、Langfuse traces/observations、Airflow DagRun/TaskInstance）：
--   runs  —— 每次流程运行一行：哪个流程、谁触发（闹钟/任务/手动/外部上报）、起止、结果、token/费用合计。
--   spans —— 运行内部明细（Activity / Step / 物件调用），run_id 指向 runs；加上级记录 parent_span_id 与自动算出的层级。
--   汇总  —— v_workflow_run_stats / v_activity_span_stats，24h/7d/30d 次数、成功率、平均与 p95 时长、token、费用。
-- 总记录两种来源（header_source）：
--   owner —— 运行方自己写（定时任务调度器等），结果与起止以它为准，span 只往上加 token/费用；
--   spans —— 只上报了 span 的运行（获客线等），总记录由触发器自动建，起止/结果/token 全部由 span 加总。
-- token/费用只记最底层：span 上报的加到总记录；没有 span 的运行直接写在总记录上。
BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            text NOT NULL UNIQUE,
  workflow_id       uuid REFERENCES workflows(id) ON DELETE SET NULL,
  trigger_kind      text NOT NULL CHECK (trigger_kind IN ('schedule', 'task', 'manual', 'external')),
  trigger_ref       text,
  schedule_entry_id bigint REFERENCES ops_schedule_entries(id) ON DELETE SET NULL,
  task_run_id       uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  executor_kind     text CHECK (executor_kind IN ('code', 'agent', 'human')),
  executor_id       text,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  duration_ms       integer GENERATED ALWAYS AS (
                      CASE WHEN ended_at IS NULL THEN NULL
                           ELSE (EXTRACT(epoch FROM ended_at - started_at) * 1000)::integer END) STORED,
  outcome           text NOT NULL DEFAULT 'running' CHECK (outcome IN ('running', 'pass', 'fail', 'timeout', 'skipped', 'unknown')),
  error             text,
  model             text,
  tokens_in         bigint CHECK (tokens_in >= 0),
  tokens_out        bigint CHECK (tokens_out >= 0),
  cost_usd          numeric(14,6) CHECK (cost_usd >= 0),
  detail            jsonb,
  header_source     text NOT NULL DEFAULT 'owner' CHECK (header_source IN ('owner', 'spans')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runs_ended_after_started CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_runs_workflow_started ON runs (workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_schedule_entry_started ON runs (schedule_entry_id, started_at DESC) WHERE schedule_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runs_failed ON runs (started_at DESC) WHERE outcome IN ('fail', 'timeout');

-- spans：上级记录（Step 重试、物件嵌套调用时 run_id 分不清挂在哪次尝试下）与层级（由 id 自动算，不会矛盾）
ALTER TABLE spans ADD COLUMN IF NOT EXISTS parent_span_id uuid REFERENCES spans(id) ON DELETE SET NULL;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS span_level text GENERATED ALWAYS AS (
  CASE WHEN enabler_id IS NOT NULL THEN 'enabler'
       WHEN step_id IS NOT NULL THEN 'step'
       ELSE 'activity' END) STORED;
CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans (parent_span_id) WHERE parent_span_id IS NOT NULL;

-- 已有 spans 回填运行总记录（一个 run 生产上只挂一个流程，取非空的那个）
INSERT INTO runs (run_id, workflow_id, trigger_kind, started_at, ended_at, outcome, tokens_in, tokens_out, cost_usd, header_source)
SELECT run_id,
       (array_agg(workflow_id) FILTER (WHERE workflow_id IS NOT NULL))[1],
       'external',
       min(started_at),
       max(ended_at),
       CASE WHEN bool_or(outcome = 'fail') THEN 'fail'
            WHEN bool_or(outcome = 'pass') THEN 'pass'
            WHEN bool_and(outcome = 'skipped') THEN 'skipped'
            ELSE 'unknown' END,
       sum(tokens_in), sum(tokens_out), sum(cost_usd),
       'spans'
  FROM spans
 GROUP BY run_id
ON CONFLICT (run_id) DO NOTHING;

ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_run_id_fkey;
ALTER TABLE spans ADD CONSTRAINT spans_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE;

-- 入库前：保证总记录存在（冲突被跳过的 span 也会走到这里，建头幂等无害）
CREATE OR REPLACE FUNCTION spans_ensure_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO runs (run_id, workflow_id, trigger_kind, started_at, outcome, header_source)
  VALUES (NEW.run_id, NEW.workflow_id, 'external', NEW.started_at, 'running', 'spans')
  ON CONFLICT (run_id) DO NOTHING;
  RETURN NEW;
END $$;

-- 入库后：只对真插入的行加总（AFTER 触发器不会为 ON CONFLICT DO NOTHING 跳过的行触发，重复上报不重复算）
CREATE OR REPLACE FUNCTION spans_rollup_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE runs r SET
    workflow_id = COALESCE(r.workflow_id, NEW.workflow_id),
    tokens_in  = CASE WHEN NEW.tokens_in  IS NULL THEN r.tokens_in  ELSE COALESCE(r.tokens_in, 0)  + NEW.tokens_in  END,
    tokens_out = CASE WHEN NEW.tokens_out IS NULL THEN r.tokens_out ELSE COALESCE(r.tokens_out, 0) + NEW.tokens_out END,
    cost_usd   = CASE WHEN NEW.cost_usd   IS NULL THEN r.cost_usd   ELSE COALESCE(r.cost_usd, 0)   + NEW.cost_usd   END,
    started_at = CASE WHEN r.header_source = 'spans' THEN LEAST(r.started_at, NEW.started_at) ELSE r.started_at END,
    ended_at   = CASE WHEN r.header_source = 'spans' THEN GREATEST(r.ended_at, NEW.ended_at) ELSE r.ended_at END,
    outcome    = CASE WHEN r.header_source <> 'spans' THEN r.outcome
                      WHEN r.outcome = 'fail' OR NEW.outcome = 'fail' THEN 'fail'
                      WHEN r.outcome = 'pass' OR NEW.outcome = 'pass' THEN 'pass'
                      WHEN NEW.outcome = 'skipped' AND r.outcome IN ('running', 'skipped') THEN 'skipped'
                      ELSE 'unknown' END,
    updated_at = now()
  WHERE r.run_id = NEW.run_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS spans_ensure_run ON spans;
CREATE TRIGGER spans_ensure_run BEFORE INSERT ON spans FOR EACH ROW EXECUTE FUNCTION spans_ensure_run();
DROP TRIGGER IF EXISTS spans_rollup_run ON spans;
CREATE TRIGGER spans_rollup_run AFTER INSERT ON spans FOR EACH ROW EXECUTE FUNCTION spans_rollup_run();

-- 汇总：成功率 = 成功 /（成功 + 失败 + 超时），跳过与未知不进分母；p95 由原始记录现算
CREATE OR REPLACE VIEW v_workflow_run_stats AS
WITH w(time_window, since) AS (
  VALUES ('24h', now() - interval '24 hours'), ('7d', now() - interval '7 days'), ('30d', now() - interval '30 days')
), agg AS (
  SELECT r.workflow_id, w.time_window,
         count(*)::int AS runs,
         count(*) FILTER (WHERE r.outcome = 'pass')::int AS passed,
         count(*) FILTER (WHERE r.outcome IN ('fail', 'timeout'))::int AS failed,
         avg(r.duration_ms)::int AS avg_duration_ms,
         (percentile_cont(0.95) WITHIN GROUP (ORDER BY r.duration_ms))::int AS p95_duration_ms,
         avg(COALESCE(r.tokens_in, 0) + COALESCE(r.tokens_out, 0)) FILTER (WHERE r.tokens_in IS NOT NULL OR r.tokens_out IS NOT NULL) AS avg_tokens,
         avg(r.cost_usd) AS avg_cost_usd,
         max(r.started_at) AS last_started_at,
         (array_agg(r.outcome ORDER BY r.started_at DESC))[1] AS last_outcome
    FROM runs r JOIN w ON r.started_at >= w.since
   WHERE r.workflow_id IS NOT NULL
   GROUP BY r.workflow_id, w.time_window
)
SELECT agg.*, round(passed::numeric / NULLIF(passed + failed, 0), 4) AS success_rate FROM agg;

CREATE OR REPLACE VIEW v_activity_span_stats AS
WITH w(time_window, since) AS (
  VALUES ('24h', now() - interval '24 hours'), ('7d', now() - interval '7 days'), ('30d', now() - interval '30 days')
), agg AS (
  SELECT s.activity_id, w.time_window,
         count(*)::int AS spans,
         count(*) FILTER (WHERE s.outcome = 'pass')::int AS passed,
         count(*) FILTER (WHERE s.outcome = 'fail')::int AS failed,
         avg(s.duration_ms)::int AS avg_duration_ms,
         (percentile_cont(0.95) WITHIN GROUP (ORDER BY s.duration_ms))::int AS p95_duration_ms,
         avg(COALESCE(s.tokens_in, 0) + COALESCE(s.tokens_out, 0)) FILTER (WHERE s.tokens_in IS NOT NULL OR s.tokens_out IS NOT NULL) AS avg_tokens,
         avg(s.cost_usd) AS avg_cost_usd,
         max(s.started_at) AS last_started_at,
         (array_agg(s.outcome ORDER BY s.started_at DESC))[1] AS last_outcome
    FROM spans s JOIN w ON s.started_at >= w.since
   WHERE s.activity_id IS NOT NULL AND s.span_level = 'activity'
   GROUP BY s.activity_id, w.time_window
)
SELECT agg.*, round(passed::numeric / NULLIF(passed + failed, 0), 4) AS success_rate FROM agg;

INSERT INTO schema_version (version, description)
VALUES ('531', '执行记录 runs 表：每次流程运行一行，spans 挂总记录并加总，加上级记录与层级，流程/Activity 汇总视图')
ON CONFLICT (version) DO NOTHING;

COMMIT;
