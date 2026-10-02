-- 活动单份定义、工作流有序引用；不迁移或重编号历史 journey_steps。
BEGIN;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS source_repo text;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS source_path text;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS source_workflow text;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS source_capability text;
UPDATE workflows SET source_repo='perfectuser21/zenithjoy-workspace',
  source_path='product-map/contracts/' || mapping.capability || '.yaml',
  source_workflow=mapping.workflow, source_capability=mapping.capability
FROM (VALUES
 ('douyin_keyword_leadgen','social-keyword-leadgen','keyword_acquisition'),
 ('douyin_benchmark_leadgen','social-benchmark-leadgen','benchmark_link_acquisition')
) AS mapping(key,workflow,capability)
WHERE workflows.key=mapping.key AND workflows.source_repo IS NULL;

CREATE TABLE IF NOT EXISTS workflow_activity_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  slot_key text NOT NULL CHECK (length(slot_key)>0),
  activity_id uuid NOT NULL REFERENCES journey_steps(id),
  sequence_no integer NOT NULL CHECK (sequence_no>0),
  source_ref text,
  source_repo text,
  source_path text,
  source_commit text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id,slot_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_activity_refs_active_sequence
 ON workflow_activity_refs(workflow_id,sequence_no) WHERE active;
CREATE INDEX IF NOT EXISTS workflow_activity_refs_activity ON workflow_activity_refs(activity_id) WHERE active;
INSERT INTO workflow_activity_refs(workflow_id,slot_key,activity_id,sequence_no,source_repo,source_path,active)
 SELECT a.workflow_id,COALESCE(a.activity_key,a.id::text),a.id,a.step_number,w.source_repo,w.source_path,
   a.status IS DISTINCT FROM 'deprecated'
 FROM journey_steps a JOIN workflows w ON w.id=a.workflow_id
 ON CONFLICT(workflow_id,slot_key) DO NOTHING;
COMMENT ON TABLE workflow_activity_refs IS '工作流使用活动的唯一关系真身；journey_steps.workflow_id 仅保留旧归属兼容历史';

CREATE OR REPLACE VIEW activity_flow_metrics AS
SELECT s.activity_id,js.activity_key,COALESCE(cap.parent_journey_id,own.parent_journey_id,own.id) AS value_stream_id,
 COALESCE(s.workflow_id, CASE WHEN membership.n=1 THEN membership.workflow_id END) AS workflow_id,
 count(DISTINCT s.run_id)::integer AS runs,count(*)::integer AS span_count,
 percentile_cont(0.5) WITHIN GROUP (ORDER BY s.duration_ms) AS p50_duration_ms,
 percentile_cont(0.95) WITHIN GROUP (ORDER BY s.duration_ms) AS p95_duration_ms,
 avg(s.wait_ms)::float8 AS avg_wait_ms,
 avg(CASE WHEN s.fallback THEN 1.0 ELSE 0.0 END)::float8 AS fallback_rate,
 (1-avg(CASE WHEN s.fallback THEN 1.0 ELSE 0.0 END))::float8 AS first_pass_yield,
 avg(CASE WHEN s.outcome='pass' THEN 1.0 ELSE 0.0 END)::float8 AS pass_rate,
 sum(COALESCE(s.tokens_in,0)+COALESCE(s.tokens_out,0))::bigint AS tokens_total,
 sum(s.cost_usd) AS cost_usd_total,max(s.started_at) AS last_started_at
FROM spans s JOIN journey_steps js ON js.id=s.activity_id
LEFT JOIN LATERAL (SELECT count(DISTINCT r.workflow_id) AS n,(array_agg(DISTINCT r.workflow_id))[1] AS workflow_id
 FROM workflow_activity_refs r WHERE r.activity_id=s.activity_id AND r.active) membership ON true
LEFT JOIN workflows wf ON wf.id=COALESCE(s.workflow_id,CASE WHEN membership.n=1 THEN membership.workflow_id END)
LEFT JOIN journeys cap ON cap.id=wf.capability_id
LEFT JOIN journeys own ON own.id=js.journey_id
WHERE s.activity_id IS NOT NULL AND s.step_id IS NULL AND s.enabler_id IS NULL
 AND s.started_at>=now()-interval '7 days'
GROUP BY s.activity_id,js.activity_key,COALESCE(cap.parent_journey_id,own.parent_journey_id,own.id),
 COALESCE(s.workflow_id,CASE WHEN membership.n=1 THEN membership.workflow_id END);
INSERT INTO schema_version(version,description) VALUES('511','共享活动定义与有序工作流引用、显式来源映射、span归属及分层统计') ON CONFLICT(version) DO NOTHING;
COMMIT;
