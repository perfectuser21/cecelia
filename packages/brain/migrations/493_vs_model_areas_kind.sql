-- Migration 493: 价值流建模②（决策 3e867cad 第 1-3 张表；词表 f425e3fd；任务 ef3aeffa）
-- ① areas 自引用 parent_area_id：Sub-Area = 有父的 area（新媒体部门 → ZenithJoy）
-- ② journeys.kind：由 parent_journey_id 派生的生成列——无父 = value_stream（客户买的产品线），
--    有父 = capability（SAFe 义：客户能指着配置的功能）。生成列让"kind 与 parent 不一致"物理上不可能，
--    不需要回填、触发器或 API 改动。
-- ③ 旧表 capabilities（迁移 030：capability-scanner / analytics /capabilities 路由的系统能力清单，
--    pr_plans.capability_id 外键指向它）腾名 → capabilities_legacy：一行不动、外键随名走；同 PR 把代码引用改到新名。
--    system_capabilities（迁移 037）字段语义完全不同（capability_key / intent_tags / definition），不并入。
-- ④ 视图：value_streams 改为只出 kind='value_stream'；新建视图 capabilities = 有父的 journey。
--    391 的 capabilities_registry（→ golden_paths）保留不动供旧读者过渡；决策 3e867cad 覆盖 a340f100 的 Capability 对照。
BEGIN;

-- ① Sub-Area 树
ALTER TABLE areas ADD COLUMN IF NOT EXISTS parent_area_id uuid NULL REFERENCES areas(id) ON DELETE SET NULL;
ALTER TABLE areas DROP CONSTRAINT IF EXISTS areas_parent_not_self;
ALTER TABLE areas ADD CONSTRAINT areas_parent_not_self CHECK (parent_area_id IS NULL OR parent_area_id <> id);
CREATE INDEX IF NOT EXISTS idx_areas_parent_area_id ON areas (parent_area_id);
COMMENT ON COLUMN areas.parent_area_id IS 'Sub-Area 的父 Area（自引用树，如 新媒体部门 → ZenithJoy）；NULL = 顶层 Area。决策 3e867cad';

-- ② journeys.kind 生成列
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS kind text
  GENERATED ALWAYS AS (CASE WHEN parent_journey_id IS NULL THEN 'value_stream' ELSE 'capability' END) STORED;
CREATE INDEX IF NOT EXISTS idx_journeys_kind ON journeys (kind);
COMMENT ON COLUMN journeys.kind IS '由 parent_journey_id 派生：无父 = value_stream（价值流），有父 = capability（能力，SAFe 义）；生成列不可手写。决策 3e867cad / f425e3fd';

-- ③ 旧 capabilities 表腾名（只在它还是表时做，重放幂等；绝不 DROP、不搬行）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'capabilities' AND c.relkind = 'r' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE capabilities RENAME TO capabilities_legacy;
    COMMENT ON TABLE capabilities_legacy IS '迁移 030 的系统能力清单（capability-scanner / analytics /capabilities 路由 / pr_plans 外键），493 起腾名；名字 capabilities 归价值流建模的能力视图。决策 3e867cad';
  END IF;
END $$;

-- ④ 视图（DROP+CREATE 而非 OR REPLACE：列集从"全表"变成"过滤 + 新列 kind"，不赌旧视图列序）
--    只动 current_schema() 里的对象：裸名 DROP 会顺着 search_path 摸到别的 schema（集成测试里就是 public 的真表）；
--    capabilities 此时若仍是表（③ 守卫没命中）直接抛错——宁可炸也不静默盖表。
DO $$
DECLARE kind_ "char";
BEGIN
  SELECT c.relkind INTO kind_ FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'value_streams' AND n.nspname = current_schema();
  IF kind_ = 'v' THEN EXECUTE format('DROP VIEW %I.value_streams', current_schema()); END IF;
  kind_ := NULL;
  SELECT c.relkind INTO kind_ FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'capabilities' AND n.nspname = current_schema();
  IF kind_ = 'r' THEN
    RAISE EXCEPTION 'migration 493: capabilities is still a table in schema %, refusing to overlay a view', current_schema();
  ELSIF kind_ = 'v' THEN
    EXECUTE format('DROP VIEW %I.capabilities', current_schema());
  END IF;
END $$;
CREATE VIEW value_streams AS SELECT * FROM journeys WHERE kind = 'value_stream';
COMMENT ON VIEW value_streams IS '价值流 Value Stream = 无父的 journey（客户买的产品线）；决策 3e867cad 覆盖 a340f100 的全表别名';
CREATE VIEW capabilities AS SELECT * FROM journeys WHERE kind = 'capability';
COMMENT ON VIEW capabilities IS '能力 Capability（SAFe 义：客户能指着配置的功能）= 有父的 journey；决策 3e867cad / f425e3fd';
COMMENT ON TABLE journeys IS '价值流与能力共用表：kind=value_stream 无父 / kind=capability 有父（parent_journey_id）；视图 value_streams / capabilities；决策 3e867cad';

INSERT INTO schema_version (version, description)
VALUES ('493', '价值流建模②：areas.parent_area_id 子域树 + journeys.kind 生成列（value_stream/capability）+ value_streams/capabilities 视图 + 旧 capabilities 腾名 capabilities_legacy')
ON CONFLICT (version) DO NOTHING;

COMMIT;
