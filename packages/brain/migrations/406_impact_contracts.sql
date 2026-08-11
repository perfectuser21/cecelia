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

CREATE OR REPLACE FUNCTION prevent_impact_contract_semantic_mutation()
RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW.task_id, NEW.version, NEW.schema_version, NEW.change_kind, NEW.repo,
    NEW.base_revision, NEW.head_revision, NEW.manifest_digest,
    NEW.projection_digest, NEW.contract_hash, NEW.contract_body,
    NEW.supersedes_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.task_id, OLD.version, OLD.schema_version, OLD.change_kind, OLD.repo,
    OLD.base_revision, OLD.head_revision, OLD.manifest_digest,
    OLD.projection_digest, OLD.contract_hash, OLD.contract_body,
    OLD.supersedes_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Impact Contract semantic fields are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('active', 'invalidated'))
       OR (OLD.status = 'active' AND NEW.status IN ('superseded', 'invalidated'))
     ) THEN
    RAISE EXCEPTION 'invalid Impact Contract status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at
     AND NEW.status <> 'invalidated' THEN
    RAISE EXCEPTION 'invalidated_at may only change while invalidating a contract'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_impact_contract_semantic_mutation
  ON harness_impact_contracts;
CREATE TRIGGER trg_prevent_impact_contract_semantic_mutation
  BEFORE UPDATE ON harness_impact_contracts
  FOR EACH ROW EXECUTE FUNCTION prevent_impact_contract_semantic_mutation();

COMMENT ON TABLE harness_impact_contracts IS
  'Impact Contract 不可变版本表；记录开发任务声明的影响范围、断言和 Mapper 证据。';

INSERT INTO schema_version (version, description)
VALUES (406, 'impact_contracts')
ON CONFLICT DO NOTHING;
