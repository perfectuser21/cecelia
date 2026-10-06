-- Rollback 528：列加回并按备份回填，守卫触发器、索引、别名视图恢复；级联函数按 journey_id 删 Activity 的那行加回
-- （527 放开的非空/唯一约束不在这里恢复：回滚 528 之后若还要回到旧结构，再回滚 527）
BEGIN;

ALTER TABLE activities ADD COLUMN IF NOT EXISTS journey_id uuid, ADD COLUMN IF NOT EXISTS step_number integer, ADD COLUMN IF NOT EXISTS enabler_id uuid;

UPDATE activities a SET journey_id = b.journey_id, step_number = b.step_number, enabler_id = b.enabler_id
  FROM migration_528_activity_columns_backup b WHERE b.id = a.id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journey_steps_enabler_id_fkey') THEN
    ALTER TABLE activities ADD CONSTRAINT journey_steps_enabler_id_fkey FOREIGN KEY (enabler_id) REFERENCES warehouse_items(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_journey_steps_journey ON activities (journey_id);
DROP TRIGGER IF EXISTS trg_journey_ref_journey_steps ON activities;
CREATE TRIGGER trg_journey_ref_journey_steps BEFORE INSERT OR UPDATE OF journey_id ON activities
  FOR EACH ROW EXECUTE FUNCTION journey_ref_guard('journey_id');

CREATE OR REPLACE VIEW backbone_activities AS
  SELECT id, notion_id, journey_id, name, description, step_number, status, notion_synced_at, created_at, updated_at, promise,
         backbone_version, capability_key, activity_key, workflow_id, executor_kind, enabler_id
    FROM activities;

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
  UPDATE ops_schedule_entries SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE design_docs SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE issues SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE captures SET ref_journey_id = NULL WHERE ref_journey_id = OLD.id;
  UPDATE advancement_items SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE journey_features SET journey_id = NULL WHERE journey_id = OLD.id;
  RETURN NULL;
END $$;

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, reconcile, notes)
SELECT 'unmapped:backbone_activities', '（无 Notion 库）backbone_activities', 'mirror', 'backbone_activities', 'none', '(有 notion_id 列无血管)', 'archived', 'system',
       '{"count": true}'::jsonb, '迁移 528 回滚补回'
 WHERE NOT EXISTS (SELECT 1 FROM notion_projection_map WHERE brain_table = 'backbone_activities');

DROP TABLE IF EXISTS migration_528_activity_columns_backup;
DELETE FROM schema_version WHERE version = '528';

COMMIT;
