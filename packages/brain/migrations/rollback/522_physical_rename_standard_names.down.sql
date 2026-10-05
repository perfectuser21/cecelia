-- Rollback 522：旧名视图删掉，物理表改回旧名，重建 521 的三个标准名视图，约束名改回，函数改回旧名
BEGIN;

DROP VIEW IF EXISTS journey_steps;
DROP VIEW IF EXISTS journey_step_links;
DROP VIEW IF EXISTS enablers;

ALTER TABLE activities RENAME TO journey_steps;
ALTER TABLE activity_cells RENAME TO journey_step_links;
ALTER TABLE warehouse_items RENAME TO enablers;

DO $$
DECLARE r record; new_name text;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname, m.old_prefix, m.new_prefix
      FROM pg_constraint c
      JOIN (VALUES ('activities', 'journey_steps'), ('activity_cells', 'journey_step_links'), ('warehouse_items', 'enablers')) AS m(old_prefix, new_prefix)
        ON c.conrelid::regclass::text = m.new_prefix
     WHERE c.contype IN ('p', 'u', 'c') AND c.conname LIKE m.old_prefix || '\_%'
  LOOP
    new_name := r.new_prefix || substr(r.conname, length(r.old_prefix) + 1);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r.tbl::regclass AND conname = new_name) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, new_name);
    END IF;
  END LOOP;
END $$;

CREATE VIEW activities AS SELECT * FROM journey_steps;
CREATE VIEW activity_cells AS SELECT * FROM journey_step_links;
CREATE VIEW warehouse_items AS SELECT * FROM enablers;

DO $$
BEGIN
  EXECUTE replace(pg_get_functiondef('enforce_harness_gap_transition'::regproc), 'activity_cells AS link', 'journey_step_links AS link');
END $$;

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
  DELETE FROM journey_step_links WHERE journey_id = OLD.id;
  DELETE FROM journey_steps WHERE journey_id = OLD.id;
  UPDATE ops_schedule_entries SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE design_docs SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE issues SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE captures SET ref_journey_id = NULL WHERE ref_journey_id = OLD.id;
  UPDATE advancement_items SET journey_id = NULL WHERE journey_id = OLD.id;
  UPDATE journey_features SET journey_id = NULL WHERE journey_id = OLD.id;
  RETURN NULL;
END $$;

DELETE FROM schema_version WHERE version = '522';

COMMIT;
