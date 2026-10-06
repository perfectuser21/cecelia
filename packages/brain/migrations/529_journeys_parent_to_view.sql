-- 529: 树+仓库 v3.0 第 6 刀 PR-B——journeys 空壳父表下线，改只读 UNION ALL 视图（主理人 10-06 拍板，决策 fc6e7a99，任务 49d057f1）
-- 价值流 value_streams、能力 capabilities 是迁移 520 起的两张真表，journeys 只是它们的继承父表（0 行，INSERT 靠分流触发器）。
-- PR-A（#5999）已让生产代码不再读写父表；本迁移拆继承、删父表，同名建只读视图兜底外部消费者，视图不带写入能力（写入必须按角色直写子表）。
-- 依赖先处理：activity_flow_metrics 改读 capabilities；journey_ref_guard（10 张表的多态 journey_id 引用守卫）改按两张子表判存在。
-- 子表上的身份锁（trg_*_kind_locked）与级联删除（trg_*_after_delete）保持不动。
-- 没有任何外键指向父表（清点：pg_constraint.confrelid = journeys 为 0 行），所以拆继承不牵动引用完整性。
BEGIN;

SET LOCAL lock_timeout = '10s';

-- ① 父表必须是空的才下线（有行说明有人绕过分流触发器直写了父表，丢数据不可接受）
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM ONLY journeys;
  IF n <> 0 THEN
    RAISE EXCEPTION '迁移 529：journeys 父表自己还有 % 行，拒绝下线（先把这些行按角色迁进 value_streams / capabilities）', n;
  END IF;
END $$;

-- ② 指标视图不再读父表：能力兜底都走 capabilities
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
     LEFT JOIN capabilities cap ON ((cap.id = wf.capability_id)))
     LEFT JOIN (SELECT ap.activity_id, ap.capability_id FROM activity_placement ap) own_place ON own_place.activity_id = js.id
     LEFT JOIN capabilities own ON ((own.id = own_place.capability_id)))
  WHERE ((s.activity_id IS NOT NULL) AND (s.step_id IS NULL) AND (s.enabler_id IS NULL) AND (s.started_at >= (now() - '7 days'::interval)))
  GROUP BY s.activity_id, js.activity_key, COALESCE(cap.parent_journey_id, own.parent_journey_id, own.id), COALESCE(s.workflow_id,
        CASE
            WHEN (membership.n = 1) THEN membership.workflow_id
            ELSE NULL::uuid
        END);

-- ③ 多态 journey_id 引用守卫：价值流 id 或能力 id 存在即放行
CREATE OR REPLACE FUNCTION journey_ref_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v uuid; col text := TG_ARGV[0];
BEGIN
  EXECUTE format('SELECT ($1).%I', col) INTO v USING NEW;
  IF v IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM value_streams WHERE id = v)
     AND NOT EXISTS (SELECT 1 FROM capabilities WHERE id = v) THEN
    RAISE EXCEPTION '%.% = % 不存在于 value_streams / capabilities（迁移 520/529 外键守卫）', TG_TABLE_NAME, col, v USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

-- ④ 拆继承、删父表（分流触发器与函数一起下线）
DROP TRIGGER IF EXISTS trg_journeys_route_insert ON journeys;
DROP FUNCTION IF EXISTS journeys_route_insert();
ALTER TABLE value_streams NO INHERIT journeys;
ALTER TABLE capabilities NO INHERIT journeys;
DROP TABLE journeys;

-- ⑤ 同名只读视图（价值流 ∪ 能力）
CREATE VIEW journeys AS
  SELECT id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at, created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest, kind FROM value_streams
  UNION ALL
  SELECT id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at, created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest, kind FROM capabilities;
COMMENT ON VIEW journeys IS '兼容只读视图：价值流 ∪ 能力（迁移 529 起；此前是继承父表）。写入必须按角色直写 value_streams / capabilities；读者优先直读子表。';

INSERT INTO schema_version (version, description)
VALUES ('529', 'v3.0 第 6 刀 PR-B：journeys 空壳父表拆继承并下线，同名建只读 UNION ALL 视图；activity_flow_metrics 改读 capabilities；journey_ref_guard 改按两张子表判存在')
ON CONFLICT (version) DO NOTHING;

COMMIT;
