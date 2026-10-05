-- Rollback 520：撤回表名对齐第一段（连线表删除、enablers 复原、标准名视图删除、价值流/能力并回 journeys、外键与旧视图复原）
BEGIN;

DELETE FROM notion_projection_map WHERE notion_db_id IN ('unmapped:activities','unmapped:activity_cells');

-- 仓库连线与物件
DROP TABLE IF EXISTS item_deps;
DROP TABLE IF EXISTS activity_items;
DROP VIEW IF EXISTS warehouse_items;
DELETE FROM enablers WHERE legacy_feature_id IS NOT NULL OR key IN (
  'crm_table_base','customer_profile_card','memory_tenant_isolation','agent_runtime_base','silent_send_channel',
  'message_capture_channel','wechat_bind_install','takeover_switch','batch_remix_render_core','gp_anchor_check',
  'crm_customer_list_page','staff_tools_hub');
ALTER TABLE enablers DROP CONSTRAINT IF EXISTS enablers_shelf_check;
ALTER TABLE enablers DROP CONSTRAINT IF EXISTS enablers_kind_check;
ALTER TABLE enablers DROP COLUMN IF EXISTS shelf;
ALTER TABLE enablers DROP COLUMN IF EXISTS failure_semantics;
ALTER TABLE enablers DROP COLUMN IF EXISTS shelf_life_days;
ALTER TABLE enablers DROP COLUMN IF EXISTS source_table;
ALTER TABLE enablers DROP COLUMN IF EXISTS source_ref;
ALTER TABLE enablers DROP COLUMN IF EXISTS legacy_feature_id;
ALTER TABLE enablers ADD CONSTRAINT enablers_kind_check CHECK (kind IN ('code','agent'));

-- 旧树状态还原
UPDATE journey_features f SET status = b.payload->>'status', workflow_ref = b.payload->>'workflow_ref', updated_at = NOW()
  FROM migration_520_backup b WHERE b.table_name = 'journey_features' AND f.id = b.row_id::uuid;

-- 守卫与级联触发器
DROP TRIGGER IF EXISTS trg_journey_ref_ops_schedule_entries ON ops_schedule_entries;
DROP TRIGGER IF EXISTS trg_journey_ref_journey_steps        ON journey_steps;
DROP TRIGGER IF EXISTS trg_journey_ref_journey_step_links   ON journey_step_links;
DROP TRIGGER IF EXISTS trg_journey_ref_design_docs          ON design_docs;
DROP TRIGGER IF EXISTS trg_journey_ref_issues               ON issues;
DROP TRIGGER IF EXISTS trg_journey_ref_conversations        ON conversations;
DROP TRIGGER IF EXISTS trg_journey_ref_golden_paths         ON golden_paths;
DROP TRIGGER IF EXISTS trg_journey_ref_captures             ON captures;
DROP TRIGGER IF EXISTS trg_journey_ref_advancement_items    ON advancement_items;
DROP TRIGGER IF EXISTS trg_journey_ref_journey_features     ON journey_features;
DO $$ BEGIN
  IF to_regclass('public.ability_groups') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_journey_ref_ability_groups ON ability_groups';
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_value_streams_after_delete ON value_streams;
DROP TRIGGER IF EXISTS trg_capabilities_after_delete  ON capabilities;
DROP TRIGGER IF EXISTS trg_value_streams_kind_locked  ON value_streams;
DROP TRIGGER IF EXISTS trg_capabilities_kind_locked   ON capabilities;
DROP TRIGGER IF EXISTS trg_journeys_route_insert ON journeys;
DROP FUNCTION IF EXISTS journey_ref_guard();
DROP FUNCTION IF EXISTS journeys_child_after_delete();
DROP FUNCTION IF EXISTS journeys_child_kind_locked();
DROP FUNCTION IF EXISTS journeys_route_insert();

-- Activity / 格子 归位还原
UPDATE journey_steps a SET journey_id = (b.payload->>'journey_id')::uuid, step_number = (b.payload->>'step_number')::int,
       workflow_id = (b.payload->>'workflow_id')::uuid, updated_at = NOW()
  FROM migration_520_backup b WHERE b.table_name = 'journey_steps' AND a.id = b.row_id::uuid;
UPDATE journey_step_links c SET journey_id = (b.payload->>'journey_id')::uuid
  FROM migration_520_backup b WHERE b.table_name = 'journey_step_links.rehome' AND c.id = b.row_id::uuid;

-- 标准名视图
DROP VIEW IF EXISTS activities;
DROP VIEW IF EXISTS activity_cells;

-- 新建的 5 条流程与 2 个能力
DELETE FROM workflows WHERE key IN ('harness_relay_pipeline','video_editing_pipeline','line_health_patrol','customer_onboarding','shopify_store_ops');
DELETE FROM capabilities WHERE id IN ('c0de0520-0000-4000-8000-000000000001','c0de0520-0000-4000-8000-000000000002');

-- 价值流 / 能力 并回 journeys 父表
ALTER TABLE workflows DROP CONSTRAINT IF EXISTS workflows_capability_id_fkey;
INSERT INTO journeys (id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
                      created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest)
SELECT id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
       created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest
  FROM value_streams;
INSERT INTO journeys (id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
                      created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest)
SELECT id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at,
       created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest
  FROM capabilities;
DROP TABLE capabilities;
DROP TABLE value_streams;

ALTER TABLE journeys ADD CONSTRAINT journeys_parent_journey_id_fkey FOREIGN KEY (parent_journey_id) REFERENCES journeys(id) ON DELETE SET NULL;
ALTER TABLE workflows ADD CONSTRAINT workflows_capability_id_fkey FOREIGN KEY (capability_id) REFERENCES journeys(id) ON DELETE CASCADE;
ALTER TABLE ops_schedule_entries ADD CONSTRAINT ops_schedule_entries_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL;
ALTER TABLE journey_steps ADD CONSTRAINT journey_steps_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE;
ALTER TABLE journey_step_links ADD CONSTRAINT journey_step_links_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE;
ALTER TABLE design_docs ADD CONSTRAINT design_docs_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL;
ALTER TABLE issues ADD CONSTRAINT issues_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD CONSTRAINT conversations_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id);
ALTER TABLE golden_paths ADD CONSTRAINT golden_paths_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id);
ALTER TABLE captures ADD CONSTRAINT captures_ref_journey_id_fkey FOREIGN KEY (ref_journey_id) REFERENCES journeys(id) ON DELETE SET NULL;
ALTER TABLE advancement_items ADD CONSTRAINT advancement_items_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF to_regclass('public.ability_groups') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE ability_groups ADD CONSTRAINT ability_groups_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id)';
  END IF;
END $$;
ALTER TABLE journey_features ADD CONSTRAINT journey_features_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION workflows_capability_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journeys WHERE id = NEW.capability_id AND parent_journey_id IS NOT NULL) THEN
    RAISE EXCEPTION 'workflows.capability_id % must reference a capability (journey with parent_journey_id); decision 3e867cad', NEW.capability_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_workflows_capability_guard BEFORE INSERT OR UPDATE OF capability_id ON workflows
  FOR EACH ROW EXECUTE FUNCTION workflows_capability_guard();

CREATE VIEW value_streams AS SELECT * FROM journeys WHERE kind = 'value_stream';
CREATE VIEW capabilities  AS SELECT * FROM journeys WHERE kind = 'capability';

DROP TABLE IF EXISTS migration_520_backup;
DELETE FROM schema_version WHERE version = '520';

COMMIT;
