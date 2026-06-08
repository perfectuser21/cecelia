-- Migration 294: abilities + golden_path 能力目录与黄金路径
-- abilities = 客户价值/使能件目录（kind 区分）；golden_path = 客户流程有序引用（scope 筛 + order 排）

CREATE TABLE IF NOT EXISTS abilities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,
  area          VARCHAR(50)  NOT NULL,
  journey_id    UUID REFERENCES journeys(id) ON DELETE SET NULL,
  kind          VARCHAR(20)  NOT NULL DEFAULT 'ability',
  type          VARCHAR(50),
  workflow_ref  VARCHAR(500),
  status        VARCHAR(20)  NOT NULL DEFAULT 'planned',
  notion_id     VARCHAR(100),
  notion_synced_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT abilities_area_check CHECK (area IN ('zenithjoy','cecelia','investment')),
  CONSTRAINT abilities_kind_check CHECK (kind IN ('ability','feature')),
  CONSTRAINT abilities_status_check CHECK (status IN ('working','broken','planned'))
);
CREATE INDEX IF NOT EXISTS idx_abilities_area ON abilities(area);
CREATE INDEX IF NOT EXISTS idx_abilities_journey ON abilities(journey_id);
CREATE INDEX IF NOT EXISTS idx_abilities_kind ON abilities(kind);

CREATE TABLE IF NOT EXISTS golden_path (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  VARCHAR(20) NOT NULL,
  scope_id    UUID NOT NULL,
  order_no    INTEGER NOT NULL,
  ability_id  UUID NOT NULL REFERENCES abilities(id) ON DELETE CASCADE,
  note        TEXT,
  notion_id   VARCHAR(100),
  notion_synced_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT golden_path_scope_check CHECK (scope_type IN ('run','project','initiative','journey'))
);
CREATE INDEX IF NOT EXISTS idx_golden_path_scope ON golden_path(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_golden_path_ability ON golden_path(ability_id);
