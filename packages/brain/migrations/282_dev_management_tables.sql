-- Migration 281: Dev Management Tables — 7 张开发管理表
-- Sprint A 数据层基础：journeys/journey_steps/journey_features/
--   api_registry/db_schema_registry/test_registry/issues
--
-- 注意：
-- journey_features 与现有 features 表(smoke 状态注册)完全不同，勿混淆
-- db_schema_registry 与现有 db_schemas 表(Dashboard 前端列配置)完全不同，勿混淆
-- skill_registry 复用现有 system_registry（type='skill'），不新建表

-- 1. journeys
CREATE TABLE IF NOT EXISTS journeys (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  journey_type     VARCHAR(50)  NOT NULL DEFAULT 'user_facing'
                   CHECK (journey_type IN ('user_facing','autonomous','dev_pipeline','agent_remote')),
  maturity         VARCHAR(50)  NOT NULL DEFAULT 'not_started'
                   CHECK (maturity IN ('not_started','skeleton','mvp','production','mature')),
  status           VARCHAR(20)  NOT NULL DEFAULT 'active',
  e2e_test_path    VARCHAR(500),
  area_id          UUID         REFERENCES areas(id) ON DELETE SET NULL,
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journeys_area        ON journeys (area_id);
CREATE INDEX IF NOT EXISTS idx_journeys_maturity    ON journeys (maturity);
CREATE INDEX IF NOT EXISTS idx_journeys_notion_id   ON journeys (notion_id) WHERE notion_id IS NOT NULL;

-- 2. journey_steps
CREATE TABLE IF NOT EXISTS journey_steps (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  journey_id       UUID         NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  step_number      INT          NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'planned',
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, step_number)
);
CREATE INDEX IF NOT EXISTS idx_journey_steps_journey ON journey_steps (journey_id);

-- 3. journey_features
-- 注意：此表跟踪 Walking Skeleton 功能 thickness，与 features(smoke 状态) 无关
CREATE TABLE IF NOT EXISTS journey_features (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  journey_id       UUID         REFERENCES journeys(id) ON DELETE SET NULL,
  step_id          UUID         REFERENCES journey_steps(id) ON DELETE SET NULL,
  name             VARCHAR(200) NOT NULL,
  thickness        VARCHAR(20)  NOT NULL DEFAULT 'thin'
                   CHECK (thickness IN ('thin','medium','thick','mature')),
  status           VARCHAR(20)  NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','building','done','deprecated')),
  area_id          UUID         REFERENCES areas(id) ON DELETE SET NULL,
  unit_test_path   VARCHAR(500),
  version          VARCHAR(50),
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journey_features_journey   ON journey_features (journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_features_step      ON journey_features (step_id);
CREATE INDEX IF NOT EXISTS idx_journey_features_thickness ON journey_features (thickness);

-- 4. api_registry
CREATE TABLE IF NOT EXISTS api_registry (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  method          VARCHAR(10)  NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE','OPTIONS')),
  path            VARCHAR(500) NOT NULL,
  file_path       VARCHAR(500),
  line_number     INT,
  area            VARCHAR(50),
  description     TEXT,
  request_schema  JSONB,
  response_schema JSONB,
  scanned_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (method, path)
);
CREATE INDEX IF NOT EXISTS idx_api_registry_area ON api_registry (area);
CREATE INDEX IF NOT EXISTS idx_api_registry_path ON api_registry (path);

-- 5. db_schema_registry
-- 注意：此表存储 PostgreSQL 真实表结构，与 db_schemas(Dashboard 前端列配置) 无关
CREATE TABLE IF NOT EXISTS db_schema_registry (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   VARCHAR(200) NOT NULL UNIQUE,
  columns      JSONB        NOT NULL DEFAULT '[]',
  indexes      JSONB        NOT NULL DEFAULT '[]',
  foreign_keys JSONB        NOT NULL DEFAULT '[]',
  area         VARCHAR(50),
  scanned_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_db_schema_registry_area ON db_schema_registry (area);

-- 6. test_registry
CREATE TABLE IF NOT EXISTS test_registry (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path          VARCHAR(500) NOT NULL UNIQUE,
  test_count         INT          NOT NULL DEFAULT 0,
  covered_behaviors  TEXT[]       NOT NULL DEFAULT '{}',
  area               VARCHAR(50),
  test_type          VARCHAR(20)  CHECK (test_type IN ('unit','integration','e2e')),
  scanned_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_test_registry_area      ON test_registry (area);
CREATE INDEX IF NOT EXISTS idx_test_registry_test_type ON test_registry (test_type);

-- 7. issues
CREATE TABLE IF NOT EXISTS issues (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  title            VARCHAR(300) NOT NULL,
  body             TEXT,
  priority         VARCHAR(5)   NOT NULL DEFAULT 'P2'
                   CHECK (priority IN ('P0','P1','P2','P3')),
  status           VARCHAR(30)  NOT NULL DEFAULT 'In progress',
  sub_area         VARCHAR(50),
  area_id          UUID         REFERENCES areas(id) ON DELETE SET NULL,
  pr_url           VARCHAR(500),
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issues_priority  ON issues (priority);
CREATE INDEX IF NOT EXISTS idx_issues_status    ON issues (status);
CREATE INDEX IF NOT EXISTS idx_issues_notion_id ON issues (notion_id) WHERE notion_id IS NOT NULL;
