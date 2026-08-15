BEGIN;

DO $$
DECLARE
  authority_exists boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'work_routing_receipts'
       AND column_name = 'direct_contract_seed'
  ) THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM work_routing_receipts WHERE direct_contract_seed IS NOT NULL
    )' INTO authority_exists;
  END IF;
  IF NOT authority_exists AND EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'initiative_contracts'
       AND column_name = 'approval_provenance'
  ) THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM initiative_contracts WHERE approval_provenance IS NOT NULL
    )' INTO authority_exists;
  END IF;
  IF authority_exists THEN
    RAISE EXCEPTION 'direct_profile_contract_authority_exists';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS direct_contract_approval_provenance_immutable
  ON initiative_contracts;
DROP FUNCTION IF EXISTS reject_direct_contract_authority_mutation();

ALTER TABLE work_routing_receipts
  DROP CONSTRAINT IF EXISTS work_routing_receipts_direct_contract_seed_check;
ALTER TABLE initiative_contracts
  DROP CONSTRAINT IF EXISTS initiative_contracts_approval_provenance_check;
ALTER TABLE work_routing_receipts
  DROP COLUMN IF EXISTS direct_contract_seed;
ALTER TABLE initiative_contracts
  DROP COLUMN IF EXISTS approval_provenance;

DELETE FROM schema_version WHERE version = '427';

COMMIT;
