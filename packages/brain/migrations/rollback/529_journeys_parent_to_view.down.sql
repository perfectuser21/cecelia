-- 529 回滚：还原 journeys 继承父表（空壳）+ INSERT 分流触发器，并让两张子表重新继承它
-- 先删视图，再按 520 的形状重建父表；指标视图与守卫函数还原成读 journeys 的版本。
BEGIN;

DROP VIEW journeys;

CREATE TABLE journeys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notion_id character varying(100),
    name character varying(200) NOT NULL,
    description text,
    journey_type character varying(50) DEFAULT 'user_facing'::character varying NOT NULL,
    maturity character varying(50) DEFAULT 'not_started'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    e2e_test_path character varying(500),
    area_id uuid,
    notion_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    home text,
    "trigger" text,
    endpoint text,
    domain character varying(100),
    biz_area text,
    parent_journey_id uuid,
    capability_code text,
    notion_digest text,
    kind text GENERATED ALWAYS AS (
CASE
    WHEN (parent_journey_id IS NULL) THEN 'value_stream'::text
    ELSE 'capability'::text
END) STORED
);
-- 四条检查约束：取子表上的文本，在父表和两张子表上用同一份文本重建（重新继承要求三边规范化后的表达式完全一致；
-- 生产与从零迁移出的库里子表上的写法不同，写死会报「child table has different definition for check constraint」）
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conrelid = 'value_streams'::regclass AND contype = 'c' AND conname LIKE 'journeys\_%' ORDER BY conname LOOP
    EXECUTE format('ALTER TABLE value_streams DROP CONSTRAINT %I', r.conname);
    EXECUTE format('ALTER TABLE capabilities DROP CONSTRAINT %I', r.conname);
    EXECUTE format('ALTER TABLE journeys ADD CONSTRAINT %I %s', r.conname, r.def);
    EXECUTE format('ALTER TABLE value_streams ADD CONSTRAINT %I %s', r.conname, r.def);
    EXECUTE format('ALTER TABLE capabilities ADD CONSTRAINT %I %s', r.conname, r.def);
  END LOOP;
END $$;
COMMENT ON TABLE journeys IS '兼容父表（空壳）：SELECT/UPDATE/DELETE 透过继承落到 value_streams/capabilities，INSERT 由触发器分流；第二段切完代码即删';
COMMENT ON COLUMN journeys.home IS '四家归属：biz=业务家 / pre=绑定家 / xcut=横切家 / factory=工厂家';
COMMENT ON COLUMN journeys.biz_area IS '业务分区三桶（cecelia=系统自身/工厂域, zenithjoy=对客业务, infrastructure=机群网络底座）；渲染分组一等字段，正则仅存量兜底';
COMMENT ON COLUMN journeys.parent_journey_id IS '价值流自引用：NULL = 顶层价值流行；非 NULL = 属于某价值流的 Capability';
COMMENT ON COLUMN journeys.capability_code IS '能力轴短码（全局唯一）：价值流用 VS_FACTORY/VS_STEWARD；Capability 用 F0..F4/G1..G5/MJ5 等';
COMMENT ON COLUMN journeys.kind IS '由 parent_journey_id 派生：无父 = value_stream（价值流），有父 = capability（能力，SAFe 义）；生成列不可手写。决策 3e867cad / f425e3fd';
ALTER TABLE ONLY journeys ADD CONSTRAINT journeys_notion_id_key UNIQUE (notion_id);
ALTER TABLE ONLY journeys ADD CONSTRAINT journeys_pkey PRIMARY KEY (id);
ALTER TABLE ONLY journeys ADD CONSTRAINT journeys_area_id_fkey FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL;
CREATE INDEX idx_journeys_area ON journeys USING btree (area_id);
CREATE UNIQUE INDEX idx_journeys_capability_code ON journeys USING btree (capability_code) WHERE (capability_code IS NOT NULL);
CREATE INDEX idx_journeys_home ON journeys USING btree (home) WHERE (home IS NOT NULL);
CREATE INDEX idx_journeys_kind ON journeys USING btree (kind);
CREATE INDEX idx_journeys_maturity ON journeys USING btree (maturity);
CREATE INDEX idx_journeys_notion_id ON journeys USING btree (notion_id) WHERE (notion_id IS NOT NULL);

CREATE OR REPLACE FUNCTION journeys_route_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM value_streams WHERE id = NEW.id) OR EXISTS (SELECT 1 FROM capabilities WHERE id = NEW.id) THEN
    DELETE FROM ONLY journeys WHERE id = NEW.id;
    RETURN NULL;
  END IF;
  IF NEW.parent_journey_id IS NULL THEN
    INSERT INTO value_streams (id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
                               created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest)
    VALUES (NEW.id, NEW.notion_id, NEW.name, NEW.description, NEW.journey_type, NEW.maturity, NEW.status, NEW.e2e_test_path, NEW.area_id, NEW.notion_synced_at,
            NEW.created_at, NEW.updated_at, NEW.home, NEW."trigger", NEW.endpoint, NEW."domain", NEW.biz_area, NEW.parent_journey_id, NEW.capability_code, NEW.notion_digest);
  ELSE
    INSERT INTO capabilities (id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
                              created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest)
    VALUES (NEW.id, NEW.notion_id, NEW.name, NEW.description, NEW.journey_type, NEW.maturity, NEW.status, NEW.e2e_test_path, NEW.area_id, NEW.notion_synced_at,
            NEW.created_at, NEW.updated_at, NEW.home, NEW."trigger", NEW.endpoint, NEW."domain", NEW.biz_area, NEW.parent_journey_id, NEW.capability_code, NEW.notion_digest);
  END IF;
  DELETE FROM ONLY journeys WHERE id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_journeys_route_insert AFTER INSERT ON journeys FOR EACH ROW EXECUTE FUNCTION journeys_route_insert();

ALTER TABLE value_streams INHERIT journeys;
ALTER TABLE capabilities INHERIT journeys;

CREATE OR REPLACE FUNCTION journey_ref_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v uuid; col text := TG_ARGV[0];
BEGIN
  EXECUTE format('SELECT ($1).%I', col) INTO v USING NEW;
  IF v IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journeys WHERE id = v) THEN
    RAISE EXCEPTION '%.% = % 不存在于 value_streams / capabilities（迁移 520 外键守卫）', TG_TABLE_NAME, col, v USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

-- activity_flow_metrics 还原为读 journeys 的版本（迁移 528 的定义）
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

DELETE FROM schema_version WHERE version = '529';

COMMIT;
