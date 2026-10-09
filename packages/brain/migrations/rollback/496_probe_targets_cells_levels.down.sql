-- Rollback 496: 价值流建模⑤——删生成的 step/enabler 级格子、删三级格子列、删探针挂点列、删退役注释
BEGIN;

DELETE FROM journey_step_links WHERE cell_level IN ('step', 'enabler');

DROP INDEX IF EXISTS idx_jsl_step_id_ref;
DROP INDEX IF EXISTS idx_jsl_enabler_id;
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS journey_step_links_cell_level_check;
ALTER TABLE journey_step_links DROP COLUMN IF EXISTS step_id_ref;
ALTER TABLE journey_step_links DROP COLUMN IF EXISTS enabler_id;
ALTER TABLE journey_step_links DROP COLUMN IF EXISTS cell_level;

DROP INDEX IF EXISTS idx_step_probes_target;
ALTER TABLE step_probes DROP CONSTRAINT IF EXISTS step_probes_target_type_check;
ALTER TABLE step_probes DROP COLUMN IF EXISTS target_id;
ALTER TABLE step_probes DROP COLUMN IF EXISTS target_type;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['golden_path', 'golden_paths', 'golden_path_contract_versions'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('COMMENT ON TABLE %I IS NULL', t);
    END IF;
  END LOOP;
END $$;

DELETE FROM schema_version WHERE version = '496';

COMMIT;
