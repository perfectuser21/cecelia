BEGIN;

DROP TABLE IF EXISTS initiative_contract_artifact_seals;
DROP TABLE IF EXISTS initiative_contract_artifacts;
DROP FUNCTION IF EXISTS reject_initiative_contract_artifact_seal_mutation();
DROP FUNCTION IF EXISTS reject_initiative_contract_artifact_append();
DROP FUNCTION IF EXISTS reject_initiative_contract_artifact_update();

DELETE FROM schema_version WHERE version = '412';

COMMIT;
