-- Migration 177: 建立7张独立OKR层级表
-- visions / objectives / key_results / okr_projects / okr_scopes / okr_initiatives
-- 旧表 goals / projects 保留不删除

-- ===================== Table 1: visions =====================
CREATE TABLE IF NOT EXISTS visions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  status       varchar(50) NOT NULL DEFAULT 'active',
  area_id      uuid REFERENCES areas(id) ON DELETE SET NULL,
  owner_role   varchar(100),
  start_date   date,
  end_date     date,
  metadata     jsonb,
  custom_props jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visions_status ON visions(status);
CREATE INDEX IF NOT EXISTS idx_visions_area_id ON visions(area_id);

-- ===================== Table 2: objectives =====================
CREATE TABLE IF NOT EXISTS objectives (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vision_id    uuid REFERENCES visions(id) ON DELETE CASCADE,
  title        text NOT NULL,
  status       varchar(50) NOT NULL DEFAULT 'active',
  area_id      uuid REFERENCES areas(id) ON DELETE SET NULL,
  owner_role   varchar(100),
  start_date   date,
  end_date     date,
  metadata     jsonb,
  custom_props jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_objectives_vision_id ON objectives(vision_id);
CREATE INDEX IF NOT EXISTS idx_objectives_status ON objectives(status);
CREATE INDEX IF NOT EXISTS idx_objectives_area_id ON objectives(area_id);

-- ===================== Table 3: key_results =====================
CREATE TABLE IF NOT EXISTS key_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id   uuid REFERENCES objectives(id) ON DELETE CASCADE,
  title          text NOT NULL,
  status         varchar(50) NOT NULL DEFAULT 'pending',
  area_id        uuid REFERENCES areas(id) ON DELETE SET NULL,
  owner_role     varchar(100),
  start_date     date,
  end_date       date,
  target_value   numeric(12,2),
  current_value  numeric(12,2) DEFAULT 0,
  unit           varchar(50),
  metadata       jsonb,
  custom_props   jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_key_results_objective_id ON key_results(objective_id);
CREATE INDEX IF NOT EXISTS idx_key_results_status ON key_results(status);
CREATE INDEX IF NOT EXISTS idx_key_results_area_id ON key_results(area_id);

-- ===================== Table 4: okr_projects =====================
CREATE TABLE IF NOT EXISTS okr_projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id        uuid REFERENCES key_results(id) ON DELETE CASCADE,
  title        text NOT NULL,
  status       varchar(50) NOT NULL DEFAULT 'planning',
  area_id      uuid REFERENCES areas(id) ON DELETE SET NULL,
  owner_role   varchar(100),
  start_date   date,
  end_date     date,
  metadata     jsonb,
  custom_props jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_okr_projects_kr_id ON okr_projects(kr_id);
CREATE INDEX IF NOT EXISTS idx_okr_projects_status ON okr_projects(status);
CREATE INDEX IF NOT EXISTS idx_okr_projects_area_id ON okr_projects(area_id);

-- ===================== Table 5: okr_scopes =====================
CREATE TABLE IF NOT EXISTS okr_scopes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES okr_projects(id) ON DELETE CASCADE,
  title        text NOT NULL,
  status       varchar(50) NOT NULL DEFAULT 'planning',
  area_id      uuid REFERENCES areas(id) ON DELETE SET NULL,
  owner_role   varchar(100),
  start_date   date,
  end_date     date,
  metadata     jsonb,
  custom_props jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_okr_scopes_project_id ON okr_scopes(project_id);
CREATE INDEX IF NOT EXISTS idx_okr_scopes_status ON okr_scopes(status);

-- ===================== Table 6: okr_initiatives =====================
CREATE TABLE IF NOT EXISTS okr_initiatives (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id     uuid REFERENCES okr_scopes(id) ON DELETE CASCADE,
  title        text NOT NULL,
  status       varchar(50) NOT NULL DEFAULT 'pending',
  area_id      uuid REFERENCES areas(id) ON DELETE SET NULL,
  owner_role   varchar(100),
  start_date   date,
  end_date     date,
  metadata     jsonb,
  custom_props jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_okr_initiatives_scope_id ON okr_initiatives(scope_id);
CREATE INDEX IF NOT EXISTS idx_okr_initiatives_status ON okr_initiatives(status);

-- ===================== 数据迁移：现有活跃数据 =====================

-- 迁移 1 条活跃 vision（goals where type='vision' AND status='in_progress'）
INSERT INTO visions (id, title, status, created_at, updated_at)
SELECT
  id,
  title,
  'active',
  created_at,
  updated_at
FROM goals
WHERE type = 'vision' AND status = 'in_progress'
ON CONFLICT (id) DO NOTHING;

-- 迁移 7 条活跃 KR（goals where type='area_okr' AND status='in_progress'）
-- 注意：这些 KR 暂无 objective_id（objective 层需要手动建立后再关联）
INSERT INTO key_results (id, title, status, area_id, created_at, updated_at)
SELECT
  id,
  title,
  'in_progress',
  area_id,
  created_at,
  updated_at
FROM goals
WHERE type = 'area_okr' AND status = 'in_progress'
ON CONFLICT (id) DO NOTHING;

-- ===================== schema_version =====================
INSERT INTO schema_version (version, description, applied_at)
VALUES ('177', 'OKR 七层表结构：visions/objectives/key_results/okr_projects/okr_scopes/okr_initiatives', now())
ON CONFLICT (version) DO NOTHING;
