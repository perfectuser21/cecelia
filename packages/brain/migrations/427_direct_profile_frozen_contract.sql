BEGIN;

ALTER TABLE work_routing_receipts
  ADD COLUMN IF NOT EXISTS direct_contract_seed jsonb;

ALTER TABLE initiative_contracts
  ADD COLUMN IF NOT EXISTS approval_provenance jsonb;

-- Legacy direct receipts intentionally remain NULL. NOT VALID skips the
-- historical scan but still requires every new effective direct profile to
-- carry the immutable request-time server snapshot.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'work_routing_receipts'::regclass
       AND conname = 'work_routing_receipts_direct_contract_seed_check'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_direct_contract_seed_check
      CHECK (
        work_kind <> 'coding_mutation'
        OR CASE
          WHEN COALESCE(execution_profile_override, default_execution_profile)
               IN ('hotfix-v1', 'parameter-only-v1')
          THEN direct_contract_seed IS NOT NULL
            AND jsonb_typeof(direct_contract_seed) = 'object'
            AND direct_contract_seed->>'contract_version'
                  = 'direct-profile-contract-seed/v1'
            AND NULLIF(BTRIM(direct_contract_seed->>'title'), '') IS NOT NULL
            AND NULLIF(BTRIM(direct_contract_seed->>'objective'), '') IS NOT NULL
            AND OCTET_LENGTH(direct_contract_seed->>'title') <= 4096
            AND OCTET_LENGTH(direct_contract_seed->>'objective') <= 65536
            AND direct_contract_seed->>'execution_profile'
                  = COALESCE(execution_profile_override, default_execution_profile)
          ELSE direct_contract_seed IS NULL
        END
      ) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'initiative_contracts'::regclass
       AND conname = 'initiative_contracts_approval_provenance_check'
  ) THEN
    ALTER TABLE initiative_contracts
      ADD CONSTRAINT initiative_contracts_approval_provenance_check
      CHECK (
        approval_provenance IS NULL
        OR (
          jsonb_typeof(approval_provenance) = 'object'
          AND approval_provenance->>'kind' = 'direct'
          AND approval_provenance->>'policy_version'
                = 'direct-profile-contract-policy/v1'
          AND approval_provenance->>'routing_receipt_id'
                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND approval_provenance->>'impact_contract_id'
                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND approval_provenance->>'impact_contract_hash' ~ '^[0-9a-f]{64}$'
          AND approval_provenance->>'input_base_sha' ~ '^[0-9a-f]{40}$'
        )
      ) NOT VALID;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION reject_direct_contract_authority_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approval_provenance IS NOT NULL
     AND NEW.approval_provenance IS DISTINCT FROM OLD.approval_provenance THEN
    RAISE EXCEPTION 'direct_profile_contract_approval_provenance_immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS direct_contract_approval_provenance_immutable
  ON initiative_contracts;
CREATE TRIGGER direct_contract_approval_provenance_immutable
BEFORE UPDATE OF approval_provenance ON initiative_contracts
FOR EACH ROW EXECUTE FUNCTION reject_direct_contract_authority_mutation();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('427', 'Freeze direct profile seed and approved contract provenance', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
