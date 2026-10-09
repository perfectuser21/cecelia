-- 528: 树+仓库 v3.0 第 5 刀③——删 Activity 上与流程树重复的旧直挂列
-- 树是 价值流 → 能力 → 流程 → Activity，Activity 的位置只由流程引用决定（迁移 526 把无流程的挂靠，527 起读者与写入方都走 activity_placement）。
-- 删：journey_id（直挂能力）、step_number（顺序，在流程引用的 sequence_no 里）、enabler_id（改走用料 activity_uses）。
-- 保留：capability_key / activity_key（Activity 的名字键，`能力键.活动键`，冻结的定义版本和合同同步都靠它认人，不是树上的位置）、workflow_id（旧归属，仅兼容历史）。
-- 依赖这些列的东西一并处理：backbone_activities（只是 activities 的别名视图）下线；activity_flow_metrics 的能力兜底改走 activity_placement；
-- 级联函数 journeys_child_after_delete 不再按 journey_id 删 Activity；journey_id 的存在性守卫触发器随列删除。
BEGIN;

DROP VIEW IF EXISTS backbone_activities;

CREATE OR REPLACE VIEW activity_flow_metrics AS
 SELECT s.activity_id,
    js.activity_key,
    COALESCE(cap.parent_journey_id, own.parent_journey_id, own.id) AS value_stream_id,
    COALESCE(s.workflow_id,
        CASE
            WHEN (membership.n = 1) THEN membership.workflow_id
            ELSE NULL::uuid
        END) AS workflow_id,
    (count(DISTINCT s.run_id))::integer AS runs,
    (count(*))::integer AS span_count,
    percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((s.duration_ms)::double precision)) AS p50_duration_ms,
    percentile_cont((0.95)::double precision) WITHIN GROUP (ORDER BY ((s.duration_ms)::double precision)) AS p95_duration_ms,
    (avg(s.wait_ms))::double precision AS avg_wait_ms,
    (avg(
        CASE
            WHEN s.fallback THEN 1.0
            ELSE 0.0
        END))::double precision AS fallback_rate,
    (((1)::numeric - avg(
        CASE
            WHEN s.fallback THEN 1.0
            ELSE 0.0
        END)))::double precision AS first_pass_yield,
    (avg(
        CASE
            WHEN (s.outcome = 'pass'::text) THEN 1.0
            ELSE 0.0
        END))::double precision AS pass_rate,
    sum((COALESCE(s.tokens_in, 0) + COALESCE(s.tokens_out, 0))) AS tokens_total,
    sum(s.cost_usd) AS cost_usd_total,
    max(s.started_at) AS last_started_at
   FROM (((((spans s
     JOIN activities js ON ((js.id = s.activity_id)))
     LEFT JOIN LATERAL ( SELECT count(DISTINCT r.workflow_id) AS n,
            (array_agg(DISTINCT r.workflow_id))[1] AS workflow_id
           FROM workflow_activity_refs r
          WHERE ((r.activity_id = s.activity_id) AND r.active)) membership ON (true))
     LEFT JOIN workflows wf ON ((wf.id = COALESCE(s.workflow_id,
        CASE
            WHEN (membership.n = 1) THEN membership.workflow_id
            ELSE NULL::uuid
        END))))
     LEFT JOIN journeys cap ON ((cap.id = wf.capability_id)))
     LEFT JOIN (SELECT ap.activity_id, ap.capability_id FROM activity_placement ap) own_place ON own_place.activity_id = js.id
     LEFT JOIN journeys own ON ((own.id = own_place.capability_id)))
  WHERE ((s.activity_id IS NOT NULL) AND (s.step_id IS NULL) AND (s.enabler_id IS NULL) AND (s.started_at >= (now() - '7 days'::interval)))
  GROUP BY s.activity_id, js.activity_key, COALESCE(cap.parent_journey_id, own.parent_journey_id, own.id), COALESCE(s.workflow_id,
        CASE
            WHEN (membership.n = 1) THEN membership.workflow_id
            ELSE NULL::uuid
        END);

CREATE OR REPLACE FUNCTION journeys_child_after_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hit int;
BEGIN
  IF EXISTS (SELECT 1 FROM conversations WHERE journey_id = OLD.id)
     OR EXISTS (SELECT 1 FROM golden_paths WHERE journey_id = OLD.id) THEN
    RAISE EXCEPTION '% 行 % 仍被 conversations / golden_paths 引用，拒绝删除（迁移 520）', TG_TABLE_NAME, OLD.id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF to_regclass('public.ability_groups') IS NOT NULL THEN
    EXECUTE 'SELECT 1 FROM ability_groups WHERE journey_id = $1 LIMIT 1' INTO hit USING OLD.id;
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION '% 行 % 仍被 ability_groups 引用，拒绝删除（迁移 520）', TG_TABLE_NAME, OLD.id USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  DELETE FROM activity_cells WHERE journey_id = OLD.id;
  UPDATE ops_schedule_entries SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE design_docs SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE issues SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE captures SET ref_journey_id = NULL WHERE ref_journey_id = OLD.id;
  UPDATE advancement_items SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE journey_features SET journey_id = NULL WHERE journey_id = OLD.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_journey_ref_journey_steps ON activities;

-- 删列前备份，回滚才能还原旧位置
CREATE TABLE IF NOT EXISTS migration_528_activity_columns_backup AS
  SELECT id, journey_id, step_number, enabler_id FROM activities;

ALTER TABLE activities DROP COLUMN journey_id, DROP COLUMN step_number, DROP COLUMN enabler_id;

DELETE FROM notion_projection_map WHERE brain_table = 'backbone_activities' AND notion_db_id = 'unmapped:backbone_activities';

INSERT INTO schema_version (version, description)
VALUES ('528', 'v3.0 第 5 刀③：删 activities.journey_id / step_number / enabler_id（位置只由流程引用决定，原值备份），backbone_activities 视图下线，activity_flow_metrics 改走 activity_placement，级联函数不再按 journey_id 删 Activity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
