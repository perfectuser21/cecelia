-- packages/brain/migrations/249_features_registry.sql
-- Feature Registry: 把 feature-ledger.yaml 变成活的数据库
CREATE TABLE IF NOT EXISTS features (
  id                  VARCHAR(100) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  domain              VARCHAR(50),
  area                VARCHAR(50),
  priority            VARCHAR(5),
  status              VARCHAR(20) DEFAULT 'unknown',
  description         TEXT,
  smoke_cmd           TEXT,
  smoke_status        VARCHAR(20) DEFAULT 'unknown',
  smoke_last_run      TIMESTAMPTZ,
  has_unit_test       BOOLEAN DEFAULT FALSE,
  has_integration_test BOOLEAN DEFAULT FALSE,
  has_e2e             BOOLEAN DEFAULT FALSE,
  last_verified       DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_priority     ON features(priority);
CREATE INDEX IF NOT EXISTS idx_features_smoke_status ON features(smoke_status);
CREATE INDEX IF NOT EXISTS idx_features_domain       ON features(domain);
CREATE INDEX IF NOT EXISTS idx_features_area         ON features(area);

INSERT INTO schema_version (version) VALUES ('249') ON CONFLICT DO NOTHING;
