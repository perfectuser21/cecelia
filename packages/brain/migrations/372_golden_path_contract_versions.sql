-- Migration 372: versioned, Owner-signed Golden Path contracts
-- Final Harness Golden Path PRD §6 ②.

CREATE TABLE IF NOT EXISTS golden_path_contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  golden_path_id uuid NOT NULL REFERENCES golden_paths(id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  version integer NOT NULL CHECK (version > 0),
  contract_json jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending_signature'
    CHECK (status IN (
      'pending_signature',
      'signed',
      'invalidated',
      'superseded'
    )),
  signature_decision_id uuid UNIQUE REFERENCES decisions(id),
  signing_action_id uuid UNIQUE REFERENCES pending_actions(id),
  signed_by text,
  signed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (golden_path_id, version)
);

CREATE INDEX IF NOT EXISTS idx_gp_contract_latest
  ON golden_path_contract_versions(golden_path_id, version DESC);

CREATE UNIQUE INDEX uq_gp_contract_one_signed
  ON golden_path_contract_versions(golden_path_id)
  WHERE status = 'signed';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('372', 'Versioned Owner-signed Golden Path contracts', NOW())
ON CONFLICT (version) DO NOTHING;
