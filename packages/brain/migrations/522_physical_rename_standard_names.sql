-- 522: 树+仓库 v3.0 第 2 刀 a 段（任务 6112bbcc）——三张物理表换成标准名，旧名降为自动可更新视图
--
-- journey_steps → activities，journey_step_links → activity_cells，enablers → warehouse_items。
-- 代码本段不动：旧名视图是 SELECT * 的自动可更新视图（SELECT / INSERT / UPDATE / DELETE / ON CONFLICT / RETURNING / FOR UPDATE 实测可用）。
-- 主键/唯一/CHECK 约束名随表改成标准前缀；引用旧名的两个函数改指新名。
-- 触发器、外键、依赖视图（activity_flow_metrics / backbone_activities / acceptance_criteria）按对象 id 绑定，随表改名自动跟随。
-- 第 2 刀 b 段把代码切到标准名；c 段删旧名视图与 journeys 空壳。
BEGIN;

-- ===== 521 建的三个标准名视图先删，名字让给物理表
DROP VIEW IF EXISTS activities;
DROP VIEW IF EXISTS activity_cells;
DROP VIEW IF EXISTS warehouse_items;

-- ===== 物理换名
ALTER TABLE journey_steps RENAME TO activities;
ALTER TABLE journey_step_links RENAME TO activity_cells;
ALTER TABLE enablers RENAME TO warehouse_items;

-- ===== 约束名随表（主键/唯一/CHECK；索引随约束同名）
DO $$
DECLARE r record; new_name text;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname, m.old_prefix, m.new_prefix
      FROM pg_constraint c
      JOIN (VALUES ('journey_steps', 'activities'), ('journey_step_links', 'activity_cells'), ('enablers', 'warehouse_items')) AS m(old_prefix, new_prefix)
        ON c.conrelid::regclass::text = m.new_prefix
     WHERE c.contype IN ('p', 'u', 'c') AND c.conname LIKE m.old_prefix || '\_%'
  LOOP
    new_name := r.new_prefix || substr(r.conname, length(r.old_prefix) + 1);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r.tbl::regclass AND conname = new_name) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, new_name);
    END IF;
  END LOOP;
END $$;

-- ===== 旧名视图
CREATE VIEW journey_steps AS SELECT * FROM activities;
CREATE VIEW journey_step_links AS SELECT * FROM activity_cells;
CREATE VIEW enablers AS SELECT * FROM warehouse_items;
COMMENT ON VIEW journey_steps IS '兼容视图 → activities（迁移 522 起 activities 为物理表）；第 2 刀 c 段删';
COMMENT ON VIEW journey_step_links IS '兼容视图 → activity_cells（迁移 522 起 activity_cells 为物理表）；第 2 刀 c 段删';
COMMENT ON VIEW enablers IS '兼容视图 → warehouse_items（迁移 522 起 warehouse_items 为物理表）；第 2 刀 c 段删';

-- ===== 引用旧名的函数改指新名
DO $$
BEGIN
  EXECUTE replace(pg_get_functiondef('enforce_harness_gap_transition'::regproc), 'journey_step_links AS link', 'activity_cells AS link');
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

INSERT INTO schema_version (version, description)
VALUES ('522', 'v3.0 第 2 刀 a：journey_steps→activities、journey_step_links→activity_cells、enablers→warehouse_items 物理换名，旧名降视图，约束名随表，两个函数改指新名')
ON CONFLICT (version) DO NOTHING;

COMMIT;
