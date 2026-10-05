-- 520: 表名对齐框架标准 v2.0（决策 61143c32，任务 b90c0f9a）——第一段：建真表 + 旧名兼容视图，不改代码
--
-- 树：areas → value_streams → capabilities → workflows → activities → steps；卡片格子 activity_cells；
-- 仓库：warehouse_items（八货架）+ 连线 activity_items / item_deps。
--
-- ① journeys 拆成 value_streams / capabilities 两张真表（PostgreSQL 表继承：journeys 变成空壳父表，
--    SELECT/UPDATE/DELETE/FOR UPDATE 透过父表照旧可用；INSERT 进父表由触发器按 parent_journey_id 分流到子表并带 RETURNING）。
--    原来指向 journeys(id) 的 13 条外键：只会指能力的（workflows、ops_schedule_entries）改指 capabilities；
--    混指两种的（design_docs/issues/conversations/golden_paths/captures/advancement_items/ability_groups/journey_features）
--    和 Activity/格子 改为触发器守卫（继承可见两张子表），删除级联由子表 AFTER DELETE 触发器照原语义模拟。
-- ② journey_steps → activities，journey_step_links → activity_cells，旧名留自动可更新视图（ON CONFLICT/RETURNING/FOR UPDATE 实测可用）。
-- ③ 50 个直接挂在价值流上的 Activity 归位到能力（新建 2 个能力、5 条流程）；格子 journey_id 跟随所属 Activity。
-- ④ enablers → warehouse_items，加八货架 shelf 列；合并旧树 7 条 enabler、3 条界面类 ability、格子里 12 项底座类 base_ref；
--    新建 activity_items（Activity 用了哪些物件）与 item_deps（物件间依赖）；底座类格子复制成连线，格子行本段保留（blast-radius 还在读）。
-- 改前原值进 migration_520_backup；第二段（切代码、删视图、收紧外键）另开 PR。
BEGIN;

-- ===== 备份
CREATE TABLE IF NOT EXISTS migration_520_backup (
  table_name text NOT NULL,
  row_id     text NOT NULL,
  payload    jsonb NOT NULL,
  PRIMARY KEY (table_name, row_id)
);

INSERT INTO migration_520_backup (table_name, row_id, payload)
SELECT 'journey_steps', s.id::text, jsonb_build_object('journey_id', s.journey_id, 'step_number', s.step_number, 'workflow_id', s.workflow_id)
  FROM journey_steps s JOIN journeys j ON j.id = s.journey_id
 WHERE j.parent_journey_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO migration_520_backup (table_name, row_id, payload)
SELECT 'journey_step_links.rehome', l.id::text, jsonb_build_object('journey_id', l.journey_id)
  FROM journey_step_links l JOIN journey_steps s ON s.id = l.step_id
 WHERE l.journey_id IS DISTINCT FROM s.journey_id
ON CONFLICT DO NOTHING;

INSERT INTO migration_520_backup (table_name, row_id, payload)
SELECT 'journey_step_links.deleted', l.id::text, to_jsonb(l)
  FROM journey_step_links l
 WHERE l.cell_kind = 'base_ref' OR l.cell_level = 'enabler'
ON CONFLICT DO NOTHING;

INSERT INTO migration_520_backup (table_name, row_id, payload)
SELECT 'journey_features', f.id::text, jsonb_build_object('status', f.status, 'workflow_ref', f.workflow_ref)
  FROM journey_features f
 WHERE f.kind = 'enabler'
    OR f.id IN ('ca5fe5ec-7cab-418f-a3f6-d64287679e0c','1129d745-c536-4ed0-8724-d7a3aaa696bd','16ac50db-bbc1-4b08-b922-97e251eb57f3')
    OR f.id IN (SELECT l.feature_id FROM journey_step_links l WHERE l.cell_kind = 'base_ref' AND l.feature_id IS NOT NULL)
ON CONFLICT DO NOTHING;

-- ===== Activity / 格子 改名 + 兼容视图
ALTER TABLE journey_steps RENAME TO activities;
ALTER TABLE journey_step_links RENAME TO activity_cells;
COMMENT ON TABLE activities IS '树第 5 层：Activity（原 journey_steps，迁移 520 改名）；journey_id 暂保留列名，第二段改 capability_id';
COMMENT ON TABLE activity_cells IS 'Activity 卡片上的格子（原 journey_step_links，迁移 520 改名）：一行一格，颜色由探针算';
CREATE VIEW journey_steps AS SELECT * FROM activities;
CREATE VIEW journey_step_links AS SELECT * FROM activity_cells;
COMMENT ON VIEW journey_steps IS '兼容视图 → activities（迁移 520）；第二段切完代码即删';
COMMENT ON VIEW journey_step_links IS '兼容视图 → activity_cells（迁移 520）；第二段切完代码即删';

-- ===== 价值流 / 能力 拆两张真表（继承）
DROP VIEW IF EXISTS capabilities;
DROP VIEW IF EXISTS value_streams;

ALTER TABLE workflows            DROP CONSTRAINT IF EXISTS workflows_capability_id_fkey;
ALTER TABLE ops_schedule_entries DROP CONSTRAINT IF EXISTS ops_schedule_entries_journey_id_fkey;
ALTER TABLE activities           DROP CONSTRAINT IF EXISTS journey_steps_journey_id_fkey;
ALTER TABLE activity_cells       DROP CONSTRAINT IF EXISTS journey_step_links_journey_id_fkey;
ALTER TABLE design_docs          DROP CONSTRAINT IF EXISTS design_docs_journey_id_fkey;
ALTER TABLE issues               DROP CONSTRAINT IF EXISTS issues_journey_id_fkey;
ALTER TABLE conversations        DROP CONSTRAINT IF EXISTS conversations_journey_id_fkey;
ALTER TABLE golden_paths         DROP CONSTRAINT IF EXISTS golden_paths_journey_id_fkey;
ALTER TABLE captures             DROP CONSTRAINT IF EXISTS captures_ref_journey_id_fkey;
ALTER TABLE advancement_items    DROP CONSTRAINT IF EXISTS advancement_items_journey_id_fkey;
ALTER TABLE journey_features     DROP CONSTRAINT IF EXISTS journey_features_journey_id_fkey;
-- ability_groups 是生产库里没有迁移建表的孤儿表（CI/scratch 不存在），所有触碰都要条件化
DO $$ BEGIN
  IF to_regclass('public.ability_groups') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE ability_groups DROP CONSTRAINT IF EXISTS ability_groups_journey_id_fkey';
  END IF;
END $$;
ALTER TABLE journeys             DROP CONSTRAINT IF EXISTS journeys_parent_journey_id_fkey;

-- 约束名避开 capabilities_legacy 遗留的 capabilities_pkey
CREATE TABLE value_streams (
  CONSTRAINT value_streams_pk PRIMARY KEY (id),
  CONSTRAINT value_streams_notion_id_uq UNIQUE (notion_id),
  CONSTRAINT value_streams_is_root CHECK (parent_journey_id IS NULL)
) INHERITS (journeys);
CREATE TABLE capabilities (
  CONSTRAINT capabilities_pk PRIMARY KEY (id),
  CONSTRAINT capabilities_notion_id_uq UNIQUE (notion_id),
  CONSTRAINT capabilities_has_parent CHECK (parent_journey_id IS NOT NULL),
  CONSTRAINT capabilities_parent_journey_id_fkey FOREIGN KEY (parent_journey_id) REFERENCES value_streams(id) ON DELETE RESTRICT
) INHERITS (journeys);
COMMENT ON TABLE value_streams IS '树第 2 层：价值流（原 journeys 无父行，迁移 520 拆出）；parent_journey_id 恒 NULL';
COMMENT ON TABLE capabilities IS '树第 3 层：能力（原 journeys 有父行，迁移 520 拆出）；parent_journey_id = 所属价值流';
COMMENT ON TABLE journeys IS '兼容父表（空壳）：SELECT/UPDATE/DELETE 透过继承落到 value_streams/capabilities，INSERT 由触发器分流；第二段切完代码即删';

CREATE INDEX idx_value_streams_area ON value_streams (area_id);
CREATE INDEX idx_value_streams_maturity ON value_streams (maturity);
CREATE INDEX idx_capabilities_area ON capabilities (area_id);
CREATE INDEX idx_capabilities_parent ON capabilities (parent_journey_id);
CREATE INDEX idx_capabilities_maturity ON capabilities (maturity);
CREATE UNIQUE INDEX idx_capabilities_capability_code ON capabilities (capability_code) WHERE capability_code IS NOT NULL;

INSERT INTO value_streams (id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
                           created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest)
SELECT id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
       created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest
  FROM ONLY journeys WHERE parent_journey_id IS NULL;
INSERT INTO capabilities (id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
                          created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest)
SELECT id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
       created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest
  FROM ONLY journeys WHERE parent_journey_id IS NOT NULL;
DELETE FROM ONLY journeys;

-- INSERT INTO journeys → 按 parent_journey_id 分流到子表（RETURNING 照常返回 NEW）
CREATE OR REPLACE FUNCTION journeys_route_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
DROP TRIGGER IF EXISTS trg_journeys_route_insert ON journeys;
CREATE TRIGGER trg_journeys_route_insert AFTER INSERT ON journeys FOR EACH ROW EXECUTE FUNCTION journeys_route_insert();

-- 价值流 ↔ 能力 不允许靠改 parent_journey_id 互换身份（删了重建）
CREATE OR REPLACE FUNCTION journeys_child_kind_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.parent_journey_id IS NULL) <> (OLD.parent_journey_id IS NULL) THEN
    RAISE EXCEPTION '% 行 % 不能通过改 parent_journey_id 在价值流/能力之间互换（迁移 520）', TG_TABLE_NAME, OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_value_streams_kind_locked BEFORE UPDATE OF parent_journey_id ON value_streams FOR EACH ROW EXECUTE FUNCTION journeys_child_kind_locked();
CREATE TRIGGER trg_capabilities_kind_locked  BEFORE UPDATE OF parent_journey_id ON capabilities  FOR EACH ROW EXECUTE FUNCTION journeys_child_kind_locked();

-- 只指能力的两条真外键
ALTER TABLE workflows ADD CONSTRAINT workflows_capability_id_fkey
  FOREIGN KEY (capability_id) REFERENCES capabilities(id) ON DELETE CASCADE;
DROP TRIGGER IF EXISTS trg_workflows_capability_guard ON workflows;
DROP FUNCTION IF EXISTS workflows_capability_guard();
ALTER TABLE ops_schedule_entries ADD CONSTRAINT ops_schedule_entries_journey_id_fkey
  FOREIGN KEY (journey_id) REFERENCES capabilities(id) ON DELETE SET NULL;

-- 混指两种的引用：触发器守卫（透过父表 journeys 看到两张子表）
CREATE OR REPLACE FUNCTION journey_ref_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v uuid; col text := TG_ARGV[0];
BEGIN
  EXECUTE format('SELECT ($1).%I', col) INTO v USING NEW;
  IF v IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journeys WHERE id = v) THEN
    RAISE EXCEPTION '%.% = % 不存在于 value_streams / capabilities（迁移 520 外键守卫）', TG_TABLE_NAME, col, v USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_journey_ref_activities        BEFORE INSERT OR UPDATE OF journey_id     ON activities        FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id');
CREATE TRIGGER trg_journey_ref_activity_cells    BEFORE INSERT OR UPDATE OF journey_id     ON activity_cells    FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id');
CREATE TRIGGER trg_journey_ref_design_docs       BEFORE INSERT OR UPDATE OF journey_id     ON design_docs       FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id');
CREATE TRIGGER trg_journey_ref_issues            BEFORE INSERT OR UPDATE OF journey_id     ON issues            FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id');
CREATE TRIGGER trg_journey_ref_conversations     BEFORE INSERT OR UPDATE OF journey_id     ON conversations     FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id');
CREATE TRIGGER trg_journey_ref_golden_paths      BEFORE INSERT OR UPDATE OF journey_id     ON golden_paths      FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id');
CREATE TRIGGER trg_journey_ref_captures          BEFORE INSERT OR UPDATE OF ref_journey_id ON captures          FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('ref_journey_id');
CREATE TRIGGER trg_journey_ref_advancement_items BEFORE INSERT OR UPDATE OF journey_id     ON advancement_items FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id');
CREATE TRIGGER trg_journey_ref_journey_features  BEFORE INSERT OR UPDATE OF journey_id     ON journey_features  FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id');
DO $$ BEGIN
  IF to_regclass('public.ability_groups') IS NOT NULL THEN
    EXECUTE $t$CREATE TRIGGER trg_journey_ref_ability_groups BEFORE INSERT OR UPDATE OF journey_id ON ability_groups FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id')$t$;
  END IF;
END $$;

-- 删除价值流/能力时照原外键语义：Activity/格子 级联删，文档/议题/捕获/推进项/旧树 置空，对话/黄金路径/能力组 拒绝
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
  DELETE FROM activities WHERE journey_id = OLD.id;
  UPDATE design_docs SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE issues SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE captures SET ref_journey_id = NULL WHERE ref_journey_id = OLD.id;
  UPDATE advancement_items SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE journey_features SET journey_id = NULL WHERE journey_id = OLD.id;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_value_streams_after_delete AFTER DELETE ON value_streams FOR EACH ROW EXECUTE FUNCTION journeys_child_after_delete();
CREATE TRIGGER trg_capabilities_after_delete  AFTER DELETE ON capabilities  FOR EACH ROW EXECUTE FUNCTION journeys_child_after_delete();

-- ===== 50 个挂在价值流上的 Activity 归位到能力
-- 新建 2 个能力（Shopify 店铺运营、ZenithJoy 客户开通与绑定），部门随价值流
INSERT INTO capabilities (id, name, description, parent_journey_id, status, area_id, biz_area)
SELECT v.id::uuid, v.name, v.description, v.parent::uuid, 'active', p.area_id, 'zenithjoy'
  FROM (VALUES
  ('c0de0520-0000-4000-8000-000000000001', 'Shopify 电商自动化 · 店铺运营',       '商品管理 / 批量制作 / 店铺获客（原直接挂在价值流上的 3 个 Activity）', '8a33a19a-71eb-4e8b-a69b-4d0507321b4e'),
  ('c0de0520-0000-4000-8000-000000000002', 'ZenithJoy 客户管理 · 客户开通与绑定', '公司绑定 / 子账号管理 / 客服 PC 绑定 / 诊断报告（原直接挂在价值流上的 4 个 Activity）', 'e6270293-7ca3-4261-b01d-4de4c66e0352')
  ) AS v(id, name, description, parent)
  JOIN value_streams p ON p.id = v.parent::uuid
ON CONFLICT (id) DO NOTHING;

-- 新建 5 条流程承接归位的 Activity
INSERT INTO workflows (capability_id, key, name, channel, form, status)
SELECT v.capability_id::uuid, v.key, v.name, v.channel, v.form, 'active'
  FROM (VALUES
  ('harness_relay_pipeline',  'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', 'Harness 接力流水线（Planner→GAN→Generator→Evaluator→Final E2E）', 'internal', 'pipeline'),
  ('video_editing_pipeline',  '24504f18-bea5-4c36-a663-4c94c9baeee2', '视频剪辑流水线（提交→转录→场景→字幕→BGM→输出）',               'internal', 'pipeline'),
  ('line_health_patrol',      'b5e6287e-2597-41a9-b26f-8dba2cc18db0', 'Line 健康度巡检与告警',                                            'internal', 'scheduled'),
  ('customer_onboarding',     'c0de0520-0000-4000-8000-000000000002', '客户开通与绑定（公司绑定→子账号→客服 PC 绑定→诊断报告）',           'web',      'app'),
  ('shopify_store_ops',       'c0de0520-0000-4000-8000-000000000001', 'Shopify 店铺运营（商品管理 / 批量制作 / 获客）',                    'shopify',  'api')
  ) AS v(key, capability_id, name, channel, form)
 WHERE EXISTS (SELECT 1 FROM capabilities c WHERE c.id = v.capability_id::uuid)
ON CONFLICT (key) DO NOTHING;

-- 归位映射：价值流 → 能力（+ 流程）；Harness 6 条编号 +100 避开 F1 既有 1~11
UPDATE activities a SET journey_id = m.cap::uuid, workflow_id = COALESCE(w.id, a.workflow_id), updated_at = NOW()
  FROM (VALUES
  ('dddb0a71-3cda-4153-b38c-2c3a29164b1c', '3cb652ee-2756-4bff-8fa2-27ef94da1555', 'video_remake_pipeline'),   -- AI 爆款视频翻拍 9
  ('636a918c-8b23-4df5-baec-b1eb3308fffb', 'b5e6287e-2597-41a9-b26f-8dba2cc18db0', 'line_health_patrol'),      -- ZenithJoy 运营中枢 3
  ('e6270293-7ca3-4261-b01d-4de4c66e0352', 'c0de0520-0000-4000-8000-000000000002', 'customer_onboarding'),     -- ZenithJoy 客户管理 4
  ('bb4f2154-d5d3-4836-af11-aeeaa3c2e8c8', '24504f18-bea5-4c36-a663-4c94c9baeee2', 'video_editing_pipeline')   -- 视频剪辑 6
  ) AS m(vs, cap, wf_key)
  LEFT JOIN workflows w ON w.key = m.wf_key
 WHERE a.journey_id = m.vs::uuid
   AND EXISTS (SELECT 1 FROM capabilities c WHERE c.id = m.cap::uuid);

-- Shopify：商品上架 → 既有能力「商品上架」+ 其流程；其余 3 个 → 店铺运营
UPDATE activities a SET journey_id = '6bd7e841-14bf-4630-b667-418c39a64918', workflow_id = COALESCE((SELECT id FROM workflows WHERE key = 'shopify_product_draft_listing'), a.workflow_id), updated_at = NOW()
 WHERE a.journey_id = '8a33a19a-71eb-4e8b-a69b-4d0507321b4e' AND a.name = '商品上架(草稿创建)'
   AND EXISTS (SELECT 1 FROM capabilities WHERE id = '6bd7e841-14bf-4630-b667-418c39a64918');
UPDATE activities a SET journey_id = 'c0de0520-0000-4000-8000-000000000001', workflow_id = COALESCE((SELECT id FROM workflows WHERE key = 'shopify_store_ops'), a.workflow_id), updated_at = NOW()
 WHERE a.journey_id = '8a33a19a-71eb-4e8b-a69b-4d0507321b4e'
   AND EXISTS (SELECT 1 FROM capabilities WHERE id = 'c0de0520-0000-4000-8000-000000000001');

-- 客户智能获客路径：8 个共享 Activity（capability_key=keyword_acquisition，归关键词获客所有，对标获客经 workflow_activity_refs 共用）+ 10 条已废弃 Path2
UPDATE activities a SET journey_id = 'a1000000-0000-4000-8000-000000000001', updated_at = NOW()
 WHERE a.journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f'
   AND EXISTS (SELECT 1 FROM capabilities WHERE id = 'a1000000-0000-4000-8000-000000000001');

-- Cecelia Harness Pipeline（已废弃价值流）6 个 Activity → F1 开发闭环，编号 +100
UPDATE activities a SET journey_id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', step_number = a.step_number + 100,
       workflow_id = COALESCE((SELECT id FROM workflows WHERE key = 'harness_relay_pipeline'), a.workflow_id), updated_at = NOW()
 WHERE a.journey_id = (SELECT id FROM value_streams WHERE name = 'Cecelia Harness Pipeline' LIMIT 1)
   AND EXISTS (SELECT 1 FROM capabilities WHERE id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29');

-- 格子跟随所属 Activity 的能力
UPDATE activity_cells c SET journey_id = a.journey_id, updated_at = NOW()
  FROM activities a
 WHERE a.id = c.step_id AND c.journey_id IS DISTINCT FROM a.journey_id;

-- 归位后仍直接挂在价值流上的 Activity：生产按上面的映射应为 0；其他环境（scratch/staging 的测试数据）只告警不中断，
-- 第二段收紧 activities.journey_id → capabilities 外键前再清
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM activities a JOIN value_streams v ON v.id = a.journey_id;
  IF n > 0 THEN RAISE WARNING '迁移 520：仍有 % 个 Activity 直接挂在价值流上（非生产数据或映射外），第二段收紧外键前需归位', n; END IF;
END $$;

-- ===== 仓库：enablers → warehouse_items + 八货架；连线 activity_items / item_deps
ALTER TABLE enablers RENAME TO warehouse_items;
COMMENT ON TABLE warehouse_items IS '仓库物件（原 enablers，迁移 520 改名）：八个货架 shelf；被哪些 Activity 用见 activity_items，物件间依赖见 item_deps';
ALTER TABLE warehouse_items DROP CONSTRAINT IF EXISTS enablers_kind_check;
ALTER TABLE warehouse_items ADD CONSTRAINT warehouse_items_kind_check
  CHECK (kind IN ('code','agent','service','data','ui','infra','external','account','doc'));
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS shelf text;
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS failure_semantics text;
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS shelf_life_days integer;
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS source_table text;
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS source_ref text;
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS legacy_feature_id uuid NULL REFERENCES journey_features(id) ON DELETE SET NULL;
COMMENT ON COLUMN warehouse_items.shelf IS '八货架：platform_action 平台动作 | generic_action 通用动作 | data 数据 | service 服务 | ui 界面 | infrastructure 基础设施 | external_dependency 外部依赖 | account_secret 账号与密钥';
COMMENT ON COLUMN warehouse_items.impl_ref IS '位置（repo:path#symbol / URL / 主机）';
COMMENT ON COLUMN warehouse_items.source_table IS '喂数据的登记表：skill_registry / api_registry / db_schema_registry / system_registry / ops_model_accounts …';

UPDATE warehouse_items SET shelf = 'platform_action' WHERE key = 'return_to_results' AND shelf IS NULL;
UPDATE warehouse_items SET shelf = 'infrastructure'   WHERE key = 'device_lock'        AND shelf IS NULL;
UPDATE warehouse_items SET shelf = 'account_secret'   WHERE key = 'account_selfcheck'  AND shelf IS NULL;

-- legacy_feature_id：旧树 enabler/界面类按名字找；底座类按格子 base_ref 的 feature_id 找（旧树里它们是 kind=feature 的"底座件"行）
INSERT INTO warehouse_items (key, name, kind, shelf, impl_ref, description, legacy_feature_id)
SELECT v.key, v.name, v.kind, v.shelf, v.impl_ref, v.description,
       COALESCE((SELECT f.id FROM journey_features f WHERE f.name = v.legacy_name ORDER BY f.created_at LIMIT 1),
                (SELECT c.feature_id FROM activity_cells c WHERE c.cell_kind = 'base_ref' AND c.cell_key = v.cell_key AND c.feature_id IS NOT NULL LIMIT 1))
  FROM (VALUES
  -- 旧树 kind=enabler 7 条
  ('brain_tick_scheduler',    'Brain Tick 调度引擎',   'service', 'service',        'cecelia:packages/brain/src/tick.js',                 '调度器主循环',                         'Brain Tick 调度引擎',    NULL),
  ('ci_cd_pipeline',          'CI/CD 流水线',          'infra',   'infrastructure', 'cecelia:.github/workflows/ci.yml',                   'PR 门禁与部署流水线',                   'CI/CD 流水线',           NULL),
  ('devgate_gates',           'DevGate 门禁系统',      'infra',   'infrastructure', 'cecelia:scripts/facts-check.mjs',                    'facts-check / version-sync / dod-mapping', 'DevGate 门禁系统',   NULL),
  ('harness_relay_chain',     'Harness Relay 执行链路','service', 'service',        'cecelia:packages/brain/src/orchestrator',            '单会话技能接力执行链',                 'Harness Relay 执行链路', NULL),
  ('memory_semantic_search',  'Memory 语义搜索',       'service', 'service',        'cecelia:/api/brain/memory/search',                   '知识库向量检索',                       'Memory 语义搜索',        NULL),
  ('credential_security',     '凭据管理与安全',        'account', 'account_secret', '1Password CS Vault → ~/.credentials/',               '凭据唯一源与分发',                     '凭据管理与安全',         NULL),
  ('bark_alerting',           '告警与 Bark 推送',      'service', 'service',        'cecelia:/api/brain/notify/bark',                     '紧急告警推送',                         '告警与 Bark 推送',       NULL),
  -- 格子里混进来的底座类 base_ref 12 项（其中 2 项是流程，不建物件）
  ('crm_table_base',          'CRM 表底座',            'data',    'data',           'zenithjoy-workspace:apps/api CRM 表',                '客户/会话/消息底表',                   NULL, 'CRM 表底座'),
  ('customer_profile_card',   '客户画像卡',            'data',    'data',           'zenithjoy-workspace:CRM 客户画像',                   '客户状态 A1-A5 与画像字段',             NULL, '客户画像卡'),
  ('memory_tenant_isolation', '记忆库租户隔离',        'data',    'data',           'cecelia:packages/brain memory tenant_id',            '多租户记忆隔离',                       NULL, '记忆库租户隔离'),
  ('agent_runtime_base',      'Agent 运行时底座',      'service', 'service',        'zenithjoy-workspace:agent runtime',                  '客户机 Agent 运行时',                   NULL, 'Agent 运行时底座'),
  ('silent_send_channel',     '后台静默发送通道',      'code',    'platform_action','zenithjoy-workspace:wechat silent send',             '微信后台静默发送',                     NULL, '后台静默发送通道'),
  ('message_capture_channel', '消息/动态采集通道',     'code',    'platform_action','zenithjoy-workspace:wechat message capture',         '微信消息与朋友圈动态采集',             NULL, '消息/动态采集通道'),
  ('wechat_bind_install',     '绑定/安装（共享前置）', 'code',    'platform_action','zenithjoy-workspace:bind-install',                   '微信客服绑定与 Agent 安装',             NULL, '绑定/安装（共享前置）'),
  ('takeover_switch',         '接管开关',              'ui',      'ui',             'zenithjoy-workspace:CRM 客户列表页 接管开关',        '人工接管 / AI 应答切换',               NULL, '接管开关'),
  ('batch_remix_render_core', '批量混剪核心渲染',      'code',    'generic_action', 'zenithjoy-workspace:video remix render',             '混剪渲染核心',                         NULL, '批量混剪核心渲染'),
  ('gp_anchor_check',         'GP 锚定校验',           'code',    'generic_action', 'cecelia:.github/workflows/scripts/lint-gp-anchor-artifact.sh', '产物锚点校验',             NULL, 'GP锚定校验'),
  -- 界面类 ability 2 项
  ('crm_customer_list_page',  'CRM 客户列表页',        'ui',      'ui',             'zenithjoy-workspace:apps/api CRM 客户列表页',        '状态 A1-A5 + 接管开关',                 '中台 AI-native CRM·客户列表页(状态A1-A5+接管开关→驱动客服白名单)', NULL),
  ('staff_tools_hub',         '员工工具中心',          'ui',      'ui',             'zenithjoy-workspace:Staff Tools Hub',                '员工工具入口',                         '员工工具中心(Staff Tools Hub)', NULL)
  ) AS v(key, name, kind, shelf, impl_ref, description, legacy_name, cell_key)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE warehouse_items ALTER COLUMN shelf SET NOT NULL;
ALTER TABLE warehouse_items ADD CONSTRAINT warehouse_items_shelf_check
  CHECK (shelf IN ('platform_action','generic_action','data','service','ui','infrastructure','external_dependency','account_secret'));

CREATE VIEW enablers AS
  SELECT id, key, name, kind, impl_ref, owner, description, active, created_at, updated_at FROM warehouse_items;
COMMENT ON VIEW enablers IS '兼容视图 → warehouse_items（迁移 520）；第二段切完代码即删';

CREATE TABLE IF NOT EXISTS activity_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'uses' CHECK (role IN ('uses','depends','produces')),
  assertion_ref text,
  cell_status   text CHECK (cell_status IS NULL OR cell_status IN ('gray','red','pending','green')),
  legacy_cell_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, item_id)
);
COMMENT ON TABLE activity_items IS '连线：这件事（Activity）用了仓库里哪些物件（迁移 520；由 enabler_calls / activities.enabler_id / 底座类格子 合并）';
CREATE INDEX IF NOT EXISTS idx_activity_items_item ON activity_items (item_id);

CREATE TABLE IF NOT EXISTS item_deps (
  item_id            uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  depends_on_item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, depends_on_item_id),
  CHECK (item_id <> depends_on_item_id)
);
COMMENT ON TABLE item_deps IS '连线：物件依赖物件（标准：写在物件卡片上；迁移 520 建载体）';

INSERT INTO activity_items (activity_id, item_id, role)
SELECT ec.caller_id, ec.enabler_id, 'uses' FROM enabler_calls ec
 WHERE ec.caller_type = 'activity' AND EXISTS (SELECT 1 FROM activities a WHERE a.id = ec.caller_id)
ON CONFLICT (activity_id, item_id) DO NOTHING;
INSERT INTO activity_items (activity_id, item_id, role)
SELECT a.id, a.enabler_id, 'uses' FROM activities a WHERE a.enabler_id IS NOT NULL
ON CONFLICT (activity_id, item_id) DO NOTHING;
INSERT INTO activity_items (activity_id, item_id, role, assertion_ref, cell_status, legacy_cell_id)
SELECT c.step_id, c.enabler_id, 'uses', c.assertion_ref, c.cell_status, c.id FROM activity_cells c
 WHERE c.cell_level = 'enabler' AND c.enabler_id IS NOT NULL
ON CONFLICT (activity_id, item_id) DO NOTHING;
INSERT INTO activity_items (activity_id, item_id, role, assertion_ref, cell_status, legacy_cell_id)
SELECT c.step_id, w.id, 'depends', c.assertion_ref, c.cell_status, c.id
  FROM activity_cells c
  JOIN (VALUES
    ('CRM 表底座','crm_table_base'), ('客户画像卡','customer_profile_card'), ('记忆库租户隔离','memory_tenant_isolation'),
    ('Agent 运行时底座','agent_runtime_base'), ('后台静默发送通道','silent_send_channel'), ('消息/动态采集通道','message_capture_channel'),
    ('绑定/安装（共享前置）','wechat_bind_install'), ('接管开关','takeover_switch'), ('批量混剪核心渲染','batch_remix_render_core'),
    ('GP锚定校验','gp_anchor_check')
  ) AS m(cell_key, item_key) ON m.cell_key = c.cell_key
  JOIN warehouse_items w ON w.key = m.item_key
 WHERE c.cell_kind = 'base_ref'
ON CONFLICT (activity_id, item_id) DO NOTHING;

INSERT INTO item_deps (item_id, depends_on_item_id, note)
SELECT a.id, b.id, v.note
  FROM (VALUES
  ('silent_send_channel',     'wechat_bind_install', '发送通道依赖先完成绑定/安装'),
  ('message_capture_channel', 'wechat_bind_install', '采集通道依赖先完成绑定/安装'),
  ('takeover_switch',         'crm_table_base',      '接管开关落在 CRM 底表字段上')
  ) AS v(item_key, dep_key, note)
  JOIN warehouse_items a ON a.key = v.item_key
  JOIN warehouse_items b ON b.key = v.dep_key
ON CONFLICT DO NOTHING;

-- 底座类格子（cell_kind=base_ref / cell_level=enabler）已复制成 activity_items 连线；格子行本段保留——
-- /journey_features/:id/blast-radius 仍按 feature_id 读这些格子算塌红范围，第二段把它切到 activity_items 后再删格子行。
-- 原行已存 migration_520_backup 'journey_step_links.deleted'，第二段删除时直接可回滚。

-- 旧树里的 enabler 与界面类 ability：只标不删，workflow_ref 指向物件 key
UPDATE journey_features f SET status = 'deprecated', workflow_ref = 'item:' || w.key, updated_at = NOW()
  FROM warehouse_items w
 WHERE w.legacy_feature_id = f.id AND f.status <> 'deprecated';
UPDATE journey_features SET status = 'deprecated', workflow_ref = 'item:crm_customer_list_page', updated_at = NOW()
 WHERE id IN ('ca5fe5ec-7cab-418f-a3f6-d64287679e0c','1129d745-c536-4ed0-8724-d7a3aaa696bd') AND status <> 'deprecated';

INSERT INTO schema_version (version, description)
VALUES ('520', '表名对齐标准：journeys 拆 value_streams/capabilities 真表(继承)；journey_steps→activities；journey_step_links→activity_cells；enablers→warehouse_items 八货架 + activity_items/item_deps；50 个 Activity 归位；旧名兼容视图')
ON CONFLICT (version) DO NOTHING;

COMMIT;
