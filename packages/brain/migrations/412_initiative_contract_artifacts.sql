-- Immutable approved-contract assets transported into frozen Harness workspaces.

BEGIN;

CREATE TABLE IF NOT EXISTS initiative_contract_artifacts (
  contract_id UUID NOT NULL REFERENCES initiative_contracts(id) ON DELETE RESTRICT,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  source_revision CHAR(40) NOT NULL CHECK (source_revision ~ '^[a-f0-9]{40}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contract_id, path)
);

CREATE TABLE IF NOT EXISTS initiative_contract_artifact_seals (
  contract_id UUID PRIMARY KEY REFERENCES initiative_contracts(id) ON DELETE RESTRICT,
  artifact_count INTEGER NOT NULL CHECK (artifact_count > 0),
  manifest_sha256 CHAR(64) NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  source_revision CHAR(40) NOT NULL CHECK (source_revision ~ '^[a-f0-9]{40}$'),
  sealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION reject_initiative_contract_artifact_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'initiative_contract_artifacts are immutable after approval';
END;
$$;

DROP TRIGGER IF EXISTS initiative_contract_artifacts_immutable
  ON initiative_contract_artifacts;
CREATE TRIGGER initiative_contract_artifacts_immutable
BEFORE UPDATE OR DELETE ON initiative_contract_artifacts
FOR EACH ROW EXECUTE FUNCTION reject_initiative_contract_artifact_update();

CREATE OR REPLACE FUNCTION reject_initiative_contract_artifact_append()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'initiative_contract_artifacts:'
        || contract.initiative_id::text
        || ':'
        || contract.version::text,
      0
    )
  )
    FROM initiative_contracts AS contract
   WHERE contract.id = NEW.contract_id;
  IF EXISTS (
    SELECT 1
      FROM initiative_contract_artifact_seals
     WHERE contract_id = NEW.contract_id
  ) THEN
    RAISE EXCEPTION 'initiative_contract_artifacts are sealed after approval';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initiative_contract_artifacts_no_append
  ON initiative_contract_artifacts;
CREATE TRIGGER initiative_contract_artifacts_no_append
BEFORE INSERT ON initiative_contract_artifacts
FOR EACH ROW EXECUTE FUNCTION reject_initiative_contract_artifact_append();

CREATE OR REPLACE FUNCTION reject_initiative_contract_artifact_seal_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'initiative_contract_artifact_seals are immutable';
END;
$$;

DROP TRIGGER IF EXISTS initiative_contract_artifact_seals_immutable
  ON initiative_contract_artifact_seals;
CREATE TRIGGER initiative_contract_artifact_seals_immutable
BEFORE UPDATE OR DELETE ON initiative_contract_artifact_seals
FOR EACH ROW EXECUTE FUNCTION reject_initiative_contract_artifact_seal_mutation();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('412', 'Immutable approved Harness contract artifacts', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
