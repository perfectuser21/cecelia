-- Migration 347: MJ5 刀1：承诺地图 schema（PRD docs/prd/2026-07-17-mj5-promise-map-first-cut.prd.md §三）
-- journeys=路（GP），journey_steps=承诺步，journey_step_links 扩展为格子表（判定点③：禁平行表）

ALTER TABLE journeys ADD COLUMN IF NOT EXISTS home varchar(10);
ALTER TABLE journeys DROP CONSTRAINT IF EXISTS journeys_home_check;
ALTER TABLE journeys ADD CONSTRAINT journeys_home_check CHECK (home IS NULL OR home IN ('biz','pre','xcut','factory'));
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS domain varchar(100);
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS trigger text;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS endpoint text;

ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS promise text;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS backbone_version integer NOT NULL DEFAULT 1;

ALTER TABLE journey_features ADD COLUMN IF NOT EXISTS softness varchar(10) NOT NULL DEFAULT 'hard';
ALTER TABLE journey_features DROP CONSTRAINT IF EXISTS journey_features_softness_check;
ALTER TABLE journey_features ADD CONSTRAINT journey_features_softness_check CHECK (softness IN ('hard','soft'));

ALTER TABLE journey_step_links ALTER COLUMN step_order DROP NOT NULL;
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS feature_id uuid REFERENCES journey_features(id) ON DELETE SET NULL;
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_kind varchar(20);
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_key varchar(200);
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_status varchar(10);
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS assertion_ref text;
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS na_reason text;
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS jsl_cell_kind_check;
ALTER TABLE journey_step_links ADD CONSTRAINT jsl_cell_kind_check
  CHECK (cell_kind IS NULL OR cell_kind IN ('capability','element','scenario','base_ref'));
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS jsl_cell_status_check;
ALTER TABLE journey_step_links ADD CONSTRAINT jsl_cell_status_check
  CHECK (cell_status IS NULL OR cell_status IN ('gray','red','pending','green'));
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS jsl_cell_key_required;
ALTER TABLE journey_step_links ADD CONSTRAINT jsl_cell_key_required
  CHECK (cell_kind IS NULL OR cell_key IS NOT NULL);

-- 旧的一步一行 UNIQUE 让位给格子多行；旧语义由 partial unique 原样保留
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS journey_step_links_journey_id_step_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jsl_membership ON journey_step_links(journey_id, step_id) WHERE cell_kind IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jsl_cell ON journey_step_links(step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jsl_feature ON journey_step_links(feature_id) WHERE feature_id IS NOT NULL;
