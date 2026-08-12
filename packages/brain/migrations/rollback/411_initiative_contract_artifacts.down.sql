BEGIN;

DROP TABLE IF EXISTS initiative_contract_artifacts;
DROP FUNCTION IF EXISTS reject_initiative_contract_artifact_update();

DELETE FROM schema_version WHERE version = '411';

COMMIT;
