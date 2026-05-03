-- Migration 248: License System — licenses + license_machines
-- 实现 License 核心：tier/max_machines/expires_at + 装机配额追踪
--
-- 定价：basic=1台/¥3000, matrix=3台/¥6000, studio=10台/¥15000, enterprise=30台/¥40000

CREATE TABLE IF NOT EXISTS licenses (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key     TEXT        NOT NULL UNIQUE,
  tier            TEXT        NOT NULL CHECK (tier IN ('basic', 'matrix', 'studio', 'enterprise')),
  max_machines    INTEGER     NOT NULL CHECK (max_machines > 0),
  customer_name   TEXT,
  customer_email  TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licenses_key    ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS license_machines (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id      UUID        NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  machine_id      TEXT        NOT NULL,
  machine_name    TEXT,
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(license_id, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_license_machines_license_id ON license_machines(license_id);
