-- Migration 495: 价值流建模④（决策 3e867cad 第 9-10 张表；词表 f425e3fd；任务 ec643d60）
--
-- 词表：… → Backbone Activity → Step → Run / Span。
-- 此前 Brain 只有"跑了/没跑"（task_runs）和"格子红绿"（探针回执），没有"每一格/每一步花了多久、谁干的、第几次才对"的
-- 流动指标（处理时间、等待时间、tokens、模型、一次做对率）。本迁移把 Span 建成真表，让执行机按 Activity/Step/Enabler 上报，
-- 再用视图按 Activity 汇总近 7 天的 p50/p95/fallback_rate/first_pass_yield。
--
-- ① spans：一次 run 里一个 Activity / Step / Enabler 的一次执行。三个目标至少挂一个（CHECK）；workflow_id 冗余便于按渠道切。
--    幂等键 (run_id, COALESCE(step_id, activity_id, enabler_id), started_at)：执行机重发同一段不产生重复行。
--    duration_ms 是生成列，不让上报方自己算。
-- ② task_runs 加 workflow_id（不回填）：Brain 派发的 run 将来能挂到 Workflow，和 spans.workflow_id 同一根轴。
-- ③ activity_flow_metrics 视图：近 7 天按 activity 汇总；fallback=true 记作"不是一次做对"，first_pass_yield = 1 − fallback_rate。

BEGIN;

CREATE TABLE IF NOT EXISTS spans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  workflow_id uuid NULL REFERENCES workflows(id) ON DELETE SET NULL,
  activity_id uuid NULL REFERENCES journey_steps(id) ON DELETE SET NULL,
  step_id uuid NULL REFERENCES steps(id) ON DELETE SET NULL,
  enabler_id uuid NULL REFERENCES enablers(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  duration_ms integer GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NULL THEN NULL
         ELSE (EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::integer END
  ) STORED,
  wait_ms integer NULL,
  executor_kind text NOT NULL,
  executor_id text NULL,
  model text NULL,
  tokens_in integer NULL,
  tokens_out integer NULL,
  cost_usd numeric(12, 6) NULL,
  attempts integer NOT NULL DEFAULT 1,
  fallback boolean NOT NULL DEFAULT false,
  outcome text NOT NULL DEFAULT 'unknown',
  evidence jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spans_executor_kind_check CHECK (executor_kind IN ('code', 'agent', 'human')),
  CONSTRAINT spans_outcome_check CHECK (outcome IN ('pass', 'fail', 'skipped', 'unknown')),
  CONSTRAINT spans_target_check CHECK (activity_id IS NOT NULL OR step_id IS NOT NULL OR enabler_id IS NOT NULL),
  CONSTRAINT spans_attempts_check CHECK (attempts >= 1)
);

COMMENT ON TABLE spans IS '价值流建模④：一次 run 里一个 Activity/Step/Enabler 的一次执行（流动指标真身；决策 3e867cad）';
COMMENT ON COLUMN spans.run_id IS '执行机的 run 标识（与 task_runs.run_id / journey_assertion_receipts.run_id 同一命名空间）';
COMMENT ON COLUMN spans.executor_kind IS '谁干的：code|agent|human（与 journey_steps.executor_kind 同轴）';
COMMENT ON COLUMN spans.attempts IS '本段试了几次才到 outcome；>1 即非一次做对';
COMMENT ON COLUMN spans.fallback IS '是否走了兜底路线（重搜/重扫/人工接管）；视图据此算 fallback_rate';
COMMENT ON COLUMN spans.duration_ms IS '生成列：ended_at − started_at（毫秒），ended_at 为空则 NULL';

CREATE INDEX IF NOT EXISTS idx_spans_run ON spans (run_id);
CREATE INDEX IF NOT EXISTS idx_spans_activity_started ON spans (activity_id, started_at);
CREATE INDEX IF NOT EXISTS idx_spans_step_started ON spans (step_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spans_idem ON spans (run_id, (COALESCE(step_id, activity_id, enabler_id)), started_at);

ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS workflow_id uuid NULL REFERENCES workflows(id) ON DELETE SET NULL;
COMMENT ON COLUMN task_runs.workflow_id IS '价值流建模④：这次 run 属于哪个 Workflow（不回填，派发侧逐步接线）';

CREATE OR REPLACE VIEW activity_flow_metrics AS
SELECT
  s.activity_id,
  js.activity_key,
  js.journey_id AS value_stream_id,
  COALESCE(js.workflow_id, s.workflow_id) AS workflow_id,
  count(DISTINCT s.run_id)::integer AS runs,
  count(*)::integer AS span_count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY s.duration_ms) AS p50_duration_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY s.duration_ms) AS p95_duration_ms,
  avg(s.wait_ms)::float8 AS avg_wait_ms,
  avg(CASE WHEN s.fallback THEN 1.0 ELSE 0.0 END)::float8 AS fallback_rate,
  (1 - avg(CASE WHEN s.fallback THEN 1.0 ELSE 0.0 END))::float8 AS first_pass_yield,
  avg(CASE WHEN s.outcome = 'pass' THEN 1.0 ELSE 0.0 END)::float8 AS pass_rate,
  sum(COALESCE(s.tokens_in, 0) + COALESCE(s.tokens_out, 0))::bigint AS tokens_total,
  sum(s.cost_usd) AS cost_usd_total,
  max(s.started_at) AS last_started_at
FROM spans s
JOIN journey_steps js ON js.id = s.activity_id
WHERE s.activity_id IS NOT NULL
  AND s.started_at >= now() - interval '7 days'
GROUP BY s.activity_id, js.activity_key, js.journey_id, COALESCE(js.workflow_id, s.workflow_id);

COMMENT ON VIEW activity_flow_metrics IS '价值流建模④：近 7 天按 Backbone Activity 汇总的流动指标（runs/p50/p95/fallback_rate/first_pass_yield）';

INSERT INTO schema_version (version, description)
VALUES ('495', '价值流建模④：spans 表（Activity/Step/Enabler 级执行段 + 幂等键 + duration 生成列）+ task_runs.workflow_id + activity_flow_metrics 视图')
ON CONFLICT (version) DO NOTHING;

COMMIT;
