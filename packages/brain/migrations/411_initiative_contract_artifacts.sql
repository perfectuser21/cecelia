-- Immutable approved-contract assets transported into frozen Harness workspaces.

BEGIN;

CREATE TABLE IF NOT EXISTS initiative_contract_artifacts (
  contract_id UUID NOT NULL REFERENCES initiative_contracts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  source_revision CHAR(40) NOT NULL CHECK (source_revision ~ '^[a-f0-9]{40}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contract_id, path)
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
BEFORE UPDATE ON initiative_contract_artifacts
FOR EACH ROW EXECUTE FUNCTION reject_initiative_contract_artifact_update();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('411', 'Immutable approved Harness contract artifacts', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
