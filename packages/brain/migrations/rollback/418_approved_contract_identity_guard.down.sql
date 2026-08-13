BEGIN;

DROP TRIGGER IF EXISTS approved_contract_identity_immutable
  ON initiative_contracts;
DROP FUNCTION IF EXISTS reject_approved_contract_identity_mutation();
DELETE FROM schema_version WHERE version = '418';

COMMIT;
