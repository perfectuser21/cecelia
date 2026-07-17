-- Migration 347: 承诺地图体系 MJ5 首刀 — schema 扩展（S1）
-- PRD: docs/prd/2026-07-17-mj5-promise-map-first-cut.prd.md
-- 四表五扩展：journeys(home+trigger+endpoint) / journey_steps(promise+backbone_version)
--             journey_features(softness) / journey_step_links(feature_id+cell cols)
-- 判定点③：扩展 journey_step_links，禁建平行表

-- 1. journeys: home 四家枚举 + trigger(触发器) + endpoint(可感知终点)
ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS home      TEXT CHECK (home IN ('biz','pre','xcut','factory')),
  ADD COLUMN IF NOT EXISTS trigger   TEXT,
  ADD COLUMN IF NOT EXISTS endpoint  TEXT;

CREATE INDEX IF NOT EXISTS idx_journeys_home ON journeys(home) WHERE home IS NOT NULL;

-- 2. journey_steps: promise(承诺原文,冻结) + backbone_version(骨干版本)
ALTER TABLE journey_steps
  ADD COLUMN IF NOT EXISTS promise          TEXT,
  ADD COLUMN IF NOT EXISTS backbone_version TEXT DEFAULT '1.0';

-- 3. journey_features: softness(硬格/软格)
ALTER TABLE journey_features
  ADD COLUMN IF NOT EXISTS softness TEXT CHECK (softness IN ('hard','soft'));

-- 4. journey_step_links: feature_id(件) + 格子四列
--    格子 = 件×步 的锚；feature_id 为 NULL 时保持旧版"步骤排序"语义（存量行兼容）
ALTER TABLE journey_step_links
  ADD COLUMN IF NOT EXISTS feature_id    UUID REFERENCES journey_features(id),
  ADD COLUMN IF NOT EXISTS cell_kind     TEXT,
  ADD COLUMN IF NOT EXISTS cell_status   TEXT DEFAULT 'gray'
    CHECK (cell_status IN ('gray','red','pending','green')),
  ADD COLUMN IF NOT EXISTS assertion_ref TEXT,
  ADD COLUMN IF NOT EXISTS na_reason     TEXT;

CREATE INDEX IF NOT EXISTS idx_jsl_feature_id   ON journey_step_links(feature_id) WHERE feature_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jsl_cell_status  ON journey_step_links(cell_status);

COMMENT ON COLUMN journeys.home IS '四家归属：biz=业务家 / pre=绑定家 / xcut=横切家 / factory=工厂家';
COMMENT ON COLUMN journey_steps.promise IS '承诺原文（冻结，不因实现变而改）';
COMMENT ON COLUMN journey_step_links.cell_kind IS '格种：能力 / 要素(11选1) / 场景(8选1) / 底座引用';
COMMENT ON COLUMN journey_step_links.cell_status IS '格态：gray=未登记 / red=红灯 / pending=待验 / green=已验';
COMMENT ON COLUMN journey_step_links.assertion_ref IS '断言锚点：tests/ 路径 或 manual:<命令>';
