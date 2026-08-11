-- Migration 406: Impact Contract 不可变版本表

CREATE TABLE IF NOT EXISTS harness_impact_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'invalidated', 'superseded')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  change_kind TEXT NOT NULL
    CHECK (change_kind IN ('new_capability', 'capability_change', 'bugfix', 'parameter_only')),
  repo TEXT,
  base_revision TEXT NOT NULL,
  head_revision TEXT,
  manifest_digest TEXT CHECK (manifest_digest IS NULL OR manifest_digest ~ '^[0-9a-f]{64}$'),
  projection_digest TEXT CHECK (projection_digest IS NULL OR projection_digest ~ '^[0-9a-f]{64}$'),
  contract_hash TEXT NOT NULL,
  contract_body JSONB NOT NULL,
  supersedes_id UUID REFERENCES harness_impact_contracts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invalidated_at TIMESTAMPTZ,
  CHECK (
    status <> 'active'
    OR (manifest_digest IS NOT NULL AND projection_digest IS NOT NULL)
  ),
  UNIQUE (task_id, version)
);

CREATE INDEX IF NOT EXISTS idx_harness_impact_contracts_task_id
  ON harness_impact_contracts (task_id);

CREATE INDEX IF NOT EXISTS idx_harness_impact_contracts_status
  ON harness_impact_contracts (status);

CREATE INDEX IF NOT EXISTS idx_harness_impact_contracts_task_hash
  ON harness_impact_contracts (task_id, contract_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_harness_impact_contracts_one_active
  ON harness_impact_contracts (task_id)
  WHERE status = 'active';

COMMENT ON TABLE harness_impact_contracts IS
  'Impact Contract 不可变版本表；记录开发任务声明的影响范围、断言和 Mapper 证据。';

INSERT INTO schema_version (version, description)
VALUES (406, 'impact_contracts')
ON CONFLICT DO NOTHING;
