-- Migration 283: skill_registry 独立表 + journey_step_links 连接表
-- skill_registry 从 system_registry(type='skill') 拆出，成为独立表
-- journey_step_links 补齐 Journey-Step 多对多连接关系（对应 Notion Journey-Step 连接表）

-- 1. skill_registry
CREATE TABLE IF NOT EXISTS skill_registry (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  name             VARCHAR(200) NOT NULL UNIQUE,
  description      TEXT,
  location         VARCHAR(500),
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','deprecated','planned')),
  area_id          UUID         REFERENCES areas(id) ON DELETE SET NULL,
  metadata         JSONB        NOT NULL DEFAULT '{}',
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_registry_status ON skill_registry (status);
CREATE INDEX IF NOT EXISTS idx_skill_registry_notion ON skill_registry (notion_id)
  WHERE notion_id IS NOT NULL;

-- 迁移数据：system_registry WHERE type='skill' → skill_registry
INSERT INTO skill_registry (name, description, location, status, metadata, created_at, updated_at)
SELECT
  name,
  description,
  location,
  COALESCE(status, 'active'),
  COALESCE(metadata::jsonb, '{}'),
  created_at,
  updated_at
FROM system_registry
WHERE type = 'skill'
ON CONFLICT (name) DO NOTHING;

-- 2. journey_step_links（Journey-Step 连接表）
CREATE TABLE IF NOT EXISTS journey_step_links (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  journey_id       UUID         NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  step_id          UUID         NOT NULL REFERENCES journey_steps(id) ON DELETE CASCADE,
  step_order       INT          NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','in_progress','done','skipped')),
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, step_id)
);
CREATE INDEX IF NOT EXISTS idx_journey_step_links_journey ON journey_step_links (journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_step_links_step    ON journey_step_links (step_id);

-- Note: schema_migrations table not used in this project (no-op)
