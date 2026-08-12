BEGIN;

DROP TRIGGER IF EXISTS trg_prevent_frozen_contract_artifact_mutation
  ON initiative_contracts;
DROP FUNCTION IF EXISTS prevent_frozen_contract_artifact_mutation();
ALTER TABLE initiative_contracts
  DROP COLUMN IF EXISTS frozen_artifacts,
  DROP COLUMN IF EXISTS approved_sha;
DELETE FROM schema_version WHERE version = '411';

COMMIT;
