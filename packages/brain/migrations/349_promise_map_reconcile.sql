-- Migration 349: MJ5 刀1 和解补齐——348（容器 thin 版首刀）落了四表基础列，本迁移补齐 PRD §三 的完整格子模型。
-- spec: docs/superpowers/specs/2026-07-17-mj5-knife1-ledger-design.md（判定点③：扩展 journey_step_links，禁平行表）
-- 补：journeys.domain / journey_step_links.cell_key + cell_kind CHECK + cell_key 必填 CHECK
--     / 删旧 UNIQUE 换双 partial unique（一步多格子）/ feature_id FK 改 ON DELETE SET NULL
--     / backbone_version、softness 归一（NOT NULL + 默认值）

-- journeys: domain（mapper Mode1 按域筛选 .journeys[] | select(.domain==…)）
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS domain varchar(100);

-- journey_steps.backbone_version 归一（348 版为可空 TEXT DEFAULT '1.0'）
ALTER TABLE journey_steps ALTER COLUMN backbone_version SET DEFAULT '1.0';
UPDATE journey_steps SET backbone_version='1.0' WHERE backbone_version IS NULL;
ALTER TABLE journey_steps ALTER COLUMN backbone_version SET NOT NULL;

-- journey_features.softness 归一（348 版为可空无默认）
ALTER TABLE journey_features ALTER COLUMN softness SET DEFAULT 'hard';
UPDATE journey_features SET softness='hard' WHERE softness IS NULL;
ALTER TABLE journey_features ALTER COLUMN softness SET NOT NULL;

-- journey_step_links: 格子完整化
ALTER TABLE journey_step_links ALTER COLUMN step_order DROP NOT NULL;
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_key varchar(200);
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS jsl_cell_kind_check;
ALTER TABLE journey_step_links ADD CONSTRAINT jsl_cell_kind_check
  CHECK (cell_kind IS NULL OR cell_kind IN ('capability','element','scenario','base_ref'));
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS jsl_cell_key_required;
ALTER TABLE journey_step_links ADD CONSTRAINT jsl_cell_key_required
  CHECK (cell_kind IS NULL OR cell_key IS NOT NULL);

-- feature_id FK 改 ON DELETE SET NULL（348 版为 NO ACTION——删底座件会直接报错而非摘引用）
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS journey_step_links_feature_id_fkey;
ALTER TABLE journey_step_links ADD CONSTRAINT journey_step_links_feature_id_fkey
  FOREIGN KEY (feature_id) REFERENCES journey_features(id) ON DELETE SET NULL;

-- 一步一行 UNIQUE 让位给格子多行；旧连接语义由 partial unique 原样保留
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS journey_step_links_journey_id_step_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jsl_membership ON journey_step_links(journey_id, step_id) WHERE cell_kind IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jsl_cell ON journey_step_links(step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL;
